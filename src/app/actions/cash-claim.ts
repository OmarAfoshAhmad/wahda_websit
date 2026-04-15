"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { emitNotification } from "@/lib/sse-notifications";
import { formatCurrency, roundCurrency } from "@/lib/money";
import { normalizeCardInput } from "@/lib/card-number";
import { assertBeneficiariesBalanceInvariant, buildIdempotencyKey } from "@/lib/tx-balance-guard";

// ─── استخراج قاعدة رقم بطاقة العائلة ────────────────────────────────
function extractFamilyBaseCard(cardNumber: string): string {
  const match = cardNumber.match(/^(.*?)([WSDMFHV])(\d+)$/i);
  return match ? match[1] : cardNumber;
}

// ─── نوع بيانات عضو العائلة ─────────────────────────────────────────
export type FamilyMember = {
  id: string;
  card_number: string;
  name: string;
  remaining_balance: number;
  status: string;
  eligible: boolean; // هل مؤهل للتوزيع (نشط + رصيد > 0)
};

// ─── البحث عن أفراد العائلة ──────────────────────────────────────────
export async function lookupFamily(query: string): Promise<{
  error?: string;
  members?: FamilyMember[];
  baseCard?: string;
}> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "cash_claim")) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    return { error: "أدخل اسم المستفيد أو رقم البطاقة" };
  }

  const rateLimitError = await checkRateLimit(`cash-lookup:${session.id}`, "deduct");
  if (rateLimitError) return { error: rateLimitError };

  const normalized = normalizeCardInput(trimmed);

  // البحث عن المستفيد بالاسم أو رقم البطاقة
  const beneficiary = await prisma.beneficiary.findFirst({
    where: {
      deleted_at: null,
      OR: [
        {
          card_number: {
            equals: normalized,
            mode: "insensitive",
          },
        },
        {
          name: {
            contains: trimmed,
            mode: "insensitive",
          },
        },
      ],
    },
    select: { id: true, card_number: true, name: true },
  });

  if (!beneficiary) {
    return { error: "لا يوجد مستفيد مطابق" };
  }

  // استخراج رقم العائلة الأساسي
  const baseCard = extractFamilyBaseCard(beneficiary.card_number.toUpperCase());

  // جلب كل أفراد العائلة (غير المحذوفين)
  const allMembers = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
    },
    select: {
      id: true,
      card_number: true,
      name: true,
      remaining_balance: true,
      status: true,
    },
  });

  // فلترة الأفراد حسب قاعدة رقم البطاقة
  const familyMembers = allMembers
    .filter((m) => extractFamilyBaseCard(m.card_number.toUpperCase()) === baseCard)
    .map((m) => ({
      id: m.id,
      card_number: m.card_number,
      name: m.name,
      remaining_balance: Number(m.remaining_balance),
      status: m.status,
      eligible: m.status === "ACTIVE" && Number(m.remaining_balance) > 0,
    }))
    .sort((a, b) => b.remaining_balance - a.remaining_balance);

  if (familyMembers.length === 0) {
    return { error: "لم يتم العثور على أفراد العائلة" };
  }

  return { members: familyMembers, baseCard };
}

// ─── نوع بيانات التوزيع ─────────────────────────────────────────────
export type ClaimAllocation = {
  beneficiary_id: string;
  amount: number;
};

// ─── تنفيذ الكاش (خصم من أفراد العائلة) ─────────────────────────────
export async function executeCashClaim(input: {
  allocations: ClaimAllocation[];
  invoiceTotal: number;
  facilityId?: string;
  requestId?: string;
}): Promise<{ error?: string; success?: string }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "cash_claim")) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  const { allocations, invoiceTotal } = input;
  const cashClaimKey = buildIdempotencyKey("cash-claim", session.id, input.requestId);

  // التحقق من صحة البيانات
  if (!allocations || allocations.length === 0) {
    return { error: "لا توجد مبالغ للخصم" };
  }

  if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) {
    return { error: "قيمة الفاتورة غير صالحة" };
  }

  // التحقق من أن كل المبالغ صحيحة
  for (const alloc of allocations) {
    if (!Number.isFinite(alloc.amount) || alloc.amount <= 0) {
      return { error: "يوجد مبلغ غير صالح في التوزيع" };
    }
    // لا نسمح بأجزاء عشرية
    if (alloc.amount !== Math.floor(alloc.amount)) {
      return { error: "لا يُسمح بالمبالغ العشرية — يجب أن تكون أعدادًا صحيحة" };
    }
  }

  // التحقق من أن مجموع التوزيع = قيمة الفاتورة
  const allocationSum = roundCurrency(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocationSum !== roundCurrency(invoiceTotal)) {
    return { error: `مجموع التوزيع (${formatCurrency(allocationSum)}) لا يساوي قيمة الفاتورة (${formatCurrency(invoiceTotal)})` };
  }

  const rateLimitError = await checkRateLimit(`cash-claim:${session.id}`, "deduct");
  if (rateLimitError) return { error: rateLimitError };

  // تحديد المرفق الفعلي
  let effectiveFacilityId = session.id;
  let effectiveFacilityName = session.name;
  const requestedFacilityId = typeof input.facilityId === "string" ? input.facilityId.trim() : "";

  if (requestedFacilityId) {
    if (!session.is_admin && !session.is_manager && !session.is_employee && requestedFacilityId !== session.id) {
      return { error: "غير مصرح لك باختيار هذا المرفق" };
    }

    const targetFacility = await prisma.facility.findFirst({
      where: { id: requestedFacilityId, deleted_at: null },
      select: { id: true, name: true },
    });

    if (!targetFacility) {
      return { error: "المرفق المحدد غير موجود" };
    }

    effectiveFacilityId = targetFacility.id;
    effectiveFacilityName = targetFacility.name;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (cashClaimKey && allocations.length > 0) {
        const firstAllocationKey = `${cashClaimKey}:${allocations[0].beneficiary_id}:${allocations[0].amount}`;
        const existing = await tx.transaction.findFirst({
          where: { idempotency_key: firstAllocationKey } as never,
          select: { id: true },
        });
        if (existing) {
          return [] as Array<{
            beneficiaryId: string;
            beneficiaryName: string;
            notificationId: string;
            transactionId: string;
            amount: number;
          }>;
        }
      }

      const beneficiaryIds = allocations.map((a) => a.beneficiary_id);

      // قفل صفوف المستفيدين (FOR UPDATE)
      const locked = await tx.$queryRaw<
        Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }>
      >`
        SELECT id, name, card_number, remaining_balance, status 
        FROM "Beneficiary" 
        WHERE id = ANY(${beneficiaryIds}::text[])
        AND "deleted_at" IS NULL
        FOR UPDATE
      `;

      const lockedMap = new Map(locked.map((b) => [b.id, b]));

      // التحقق من كل تخصيص
      for (const alloc of allocations) {
        const ben = lockedMap.get(alloc.beneficiary_id);
        if (!ben) {
          throw new Error(`المستفيد غير موجود: ${alloc.beneficiary_id}`);
        }
        if (ben.status === "SUSPENDED") {
          throw new Error(`حساب ${ben.name} موقوف`);
        }
        if (ben.status === "FINISHED" || Number(ben.remaining_balance) <= 0) {
          throw new Error(`رصيد ${ben.name} صفر أو مكتمل`);
        }
        if (alloc.amount > Number(ben.remaining_balance)) {
          throw new Error(`المبلغ (${formatCurrency(alloc.amount)}) أكبر من رصيد ${ben.name} (${formatCurrency(Number(ben.remaining_balance))})`);
        }
      }

      const results: Array<{
        beneficiaryId: string;
        beneficiaryName: string;
        notificationId: string;
        transactionId: string;
        amount: number;
      }> = [];

      // خصم من كل عضو
      for (const alloc of allocations) {
        const ben = lockedMap.get(alloc.beneficiary_id)!;
        const balanceBefore = Number(ben.remaining_balance);
        const newBalance = roundCurrency(balanceBefore - alloc.amount);
        const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

        await tx.beneficiary.update({
          where: { id: alloc.beneficiary_id },
          data: {
            remaining_balance: newBalance,
            status: newStatus,
            ...(newStatus === "FINISHED" ? { completed_via: "MANUAL" } : {}),
          },
        });

        const transaction = await tx.transaction.create({
          data: {
            beneficiary_id: alloc.beneficiary_id,
            facility_id: effectiveFacilityId,
            amount: alloc.amount,
            type: "MEDICINE",
            ...(cashClaimKey
              ? { idempotency_key: `${cashClaimKey}:${alloc.beneficiary_id}:${alloc.amount}` }
              : {}),
          },
        });

        const notification = await tx.notification.create({
          data: {
            beneficiary_id: alloc.beneficiary_id,
            title: "تم خصم من رصيدك",
            message: `تم خصم ${formatCurrency(alloc.amount)} د.ل من رصيدك لدى ${effectiveFacilityName} (كاش عائلي)`,
            amount: alloc.amount,
          },
        });

        results.push({
          beneficiaryId: alloc.beneficiary_id,
          beneficiaryName: ben.name,
          notificationId: notification.id,
          transactionId: transaction.id,
          amount: alloc.amount,
        });
      }

      // سجل المراقبة
      await tx.auditLog.create({
        data: {
          facility_id: effectiveFacilityId,
          user: session.username,
          action: "CASH_CLAIM",
          metadata: {
            invoice_total: invoiceTotal,
            facility_id: effectiveFacilityId,
            facility_name: effectiveFacilityName,
            allocations: results.map((r) => ({
              beneficiary_id: r.beneficiaryId,
              beneficiary_name: r.beneficiaryName,
              amount: r.amount,
              transaction_id: r.transactionId,
            })),
          },
        },
      });

      await assertBeneficiariesBalanceInvariant(
        tx,
        allocations.map((a) => a.beneficiary_id),
        "executeCashClaim",
      );

      return results;
    });

    // إرسال إشعارات لكل مستفيد
    for (const r of result) {
      emitNotification(r.beneficiaryId, {
        id: r.notificationId,
        title: "تم خصم من رصيدك",
        message: `تم خصم ${formatCurrency(r.amount)} د.ل من رصيدك لدى ${effectiveFacilityName} (كاش عائلي)`,
        amount: r.amount,
        created_at: new Date().toISOString(),
      });
    }

    revalidatePath("/cash-claim");
    revalidatePath("/transactions");
    revalidatePath("/dashboard");

    if (result.length === 0) {
      return { success: "تم تجاهل إعادة الإرسال: الطلب منفذ مسبقاً" };
    }

    return {
      success: `تم خصم الفاتورة بنجاح (${formatCurrency(invoiceTotal)} د.ل) من ${result.length} عضو`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "خطأ غير متوقع";
    logger.error("CASH_CLAIM_FAILED", {
      user: session.username,
      invoiceTotal,
      error: msg,
    });
    return { error: msg };
  }
}
