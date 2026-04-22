"use server";

import prisma from "@/lib/prisma";
import { deductionSchema } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { emitNotification } from "@/lib/sse-notifications";
import { formatCurrency, roundCurrency } from "@/lib/money";
import { normalizeCardInput } from "@/lib/card-number";
import { assertBeneficiaryBalanceInvariant, buildIdempotencyKey } from "@/lib/tx-balance-guard";

export async function deductBalance(formData: {
  beneficiary_id?: string;
  card_number: string;
  amount: number;
  type: "MEDICINE" | "SUPPLIES";
  transactionDate?: Date;
  facilityId?: string;
  requestId?: string;
}) {
  const session = await requireActiveFacilitySession();
  const canDeduct = !!session && !session.is_employee && (!session.is_manager || hasPermission(session, "deduct_balance"));
  if (!canDeduct) {
    return { error: "غير مصرح لك بهذه العملية (خصم الرصيد)" };
  }

  let effectiveFacilityId = session.id;
  let effectiveFacilityName = session.name;
  const requestedFacilityId = typeof formData.facilityId === "string" ? formData.facilityId.trim() : "";

  if (requestedFacilityId) {
    if (!session.is_admin && !session.is_manager && requestedFacilityId !== session.id) {
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

  const rateLimitError = await checkRateLimit(`deduct:${session.id}`, "deduct");
  if (rateLimitError) return { error: rateLimitError };

  const normalizedCard = normalizeCardInput(formData.card_number ?? "");
  const beneficiaryIdInput = typeof formData.beneficiary_id === "string" ? formData.beneficiary_id.trim() : "";

  const validated = deductionSchema.safeParse({
    ...formData,
    card_number: normalizedCard,
  });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { card_number, amount, type } = validated.data;

  if (!session.is_admin && !session.is_manager && session.facility_type === "PHARMACY" && type === "SUPPLIES") {
    return { error: "حسابات الصيدليات لا يمكنها تنفيذ نوع كشف عام" };
  }

  const manualTransactionDate =
    formData.transactionDate instanceof Date && !Number.isNaN(formData.transactionDate.getTime())
      ? formData.transactionDate
      : null;
  const idempotencyKey = buildIdempotencyKey("deduct", session.id, formData.requestId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.transaction.findUnique({
          where: { idempotency_key: idempotencyKey },
          select: { id: true, beneficiary_id: true },
        });

        if (existing) {
          const beneficiary = await tx.beneficiary.findUnique({
            where: { id: existing.beneficiary_id },
            select: { remaining_balance: true },
          });

          return {
            success: true,
            duplicated: true,
            newBalance: Number(beneficiary?.remaining_balance ?? 0),
            beneficiaryId: existing.beneficiary_id,
            notificationId: "",
            transaction: undefined,
          };
        }
      }

      // 1. Get beneficiary with row-level lock (using raw sql as Prisma interactive tx isn't always enough for specific locking locks)
      // On PostgreSQL, we can use SELECT ... FOR UPDATE
      const beneficiaries = beneficiaryIdInput
        ? await tx.$queryRaw<Array<{ id: string; name: string; remaining_balance: number; total_balance: number; status: string }>>`
          SELECT id, name, remaining_balance, total_balance::float8, status FROM "Beneficiary"
          WHERE id = ${beneficiaryIdInput}
            AND "deleted_at" IS NULL
          LIMIT 1
          FOR UPDATE
        `
        : await tx.$queryRaw<Array<{ id: string; name: string; remaining_balance: number; total_balance: number; status: string }>>`
          SELECT id, name, remaining_balance, total_balance::float8, status FROM "Beneficiary"
          WHERE TRANSLATE(
            REGEXP_REPLACE(UPPER(card_number), '[^A-Z0-9٠-٩۰-۹]+', '', 'g'),
            '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
            '01234567890123456789'
          ) = TRANSLATE(
            REGEXP_REPLACE(UPPER(${card_number}), '[^A-Z0-9٠-٩۰-۹]+', '', 'g'),
            '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
            '01234567890123456789'
          )
          AND "deleted_at" IS NULL
          ORDER BY created_at DESC
          LIMIT 2
          FOR UPDATE
        `;

      if (beneficiaries.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      if (!beneficiaryIdInput && beneficiaries.length > 1) {
        throw new Error("يوجد أكثر من سجل بنفس رقم البطاقة. يرجى دمج التكرار أولاً قبل الخصم.");
      }

      const beneficiary = beneficiaries[0];

      // FIX: منع الخصم من المستفيدين الموقوفين (SUSPENDED) أيضاً
      if (beneficiary.status === "SUSPENDED") {
        throw new Error("حساب المستفيد موقوف ولا يمكن إجراء خصم عليه");
      }
      if (beneficiary.status === "FINISHED" || beneficiary.remaining_balance <= 0) {
        throw new Error("رصيد المستفيد صفر أو مكتمل");
      }

      if (amount > beneficiary.remaining_balance) {
        throw new Error(`المبلغ أكبر من الرصيد المتاح (${formatCurrency(Number(beneficiary.remaining_balance))} د.ل)`);
      }

      const balanceBefore = Number(beneficiary.remaining_balance);
      const newBalance = roundCurrency(balanceBefore - amount);
      const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

      // 2. Update beneficiary
      await tx.beneficiary.update({
        where: { id: beneficiary.id },
        data: {
          remaining_balance: newBalance,
          status: newStatus,
          ...(newStatus === "FINISHED" ? { completed_via: "MANUAL" } : {}),
        },
      });

      // 3. Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          beneficiary_id: beneficiary.id,
          facility_id: effectiveFacilityId,
          amount,
          type,
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
          ...(manualTransactionDate ? { created_at: manualTransactionDate } : {}),
        },
      });

      // 3.1 Create in-app notification
      const notification = await tx.notification.create({
        data: {
          beneficiary_id: beneficiary.id,
          title: "تم خصم من رصيدك",
          message: `تم خصم ${formatCurrency(Number(amount))} د.ل من رصيدك لدى ${effectiveFacilityName}`,
          amount,
        },
      });

      // 4. Create audit log
      await tx.auditLog.create({
        data: {
          facility_id: effectiveFacilityId,
          user: session.username,
          action: "DEDUCT_BALANCE",
          metadata: {
            beneficiary_name: beneficiary.name,
            card_number,
            amount,
            type,
            balance_before: balanceBefore,
            balance_after: newBalance,
            transaction_id: transaction.id,
            facility_id: effectiveFacilityId,
            facility_name: effectiveFacilityName,
            ...(manualTransactionDate ? { transaction_date: manualTransactionDate.toISOString() } : {}),
            ...(newStatus === "FINISHED" ? { beneficiary_completed: true } : {}),
          },
        },
      });

      // إصلاح انزياح total_balance تلقائياً قبل فحص الثابت
      // يحدث هذا الانزياح أحياناً بسبب بيانات قديمة أو عمليات استيراد سابقة أخطأت في ضبط total_balance
      const spentAfterDeduction = await tx.transaction.aggregate({
        where: { beneficiary_id: beneficiary.id, is_cancelled: false, type: { not: "CANCELLATION" } },
        _sum: { amount: true },
      });
      const actualSpent = roundCurrency(Number(spentAfterDeduction._sum.amount ?? 0));
      const expectedTotal = roundCurrency(actualSpent + newBalance);
      const storedTotal = roundCurrency(Number(beneficiary.total_balance));
      if (storedTotal !== expectedTotal) {
        await tx.beneficiary.update({
          where: { id: beneficiary.id },
          data: { total_balance: expectedTotal },
        });
        logger.warn("total_balance drift detected and repaired during deduction", {
          beneficiary_id: beneficiary.id,
          stored_total: storedTotal,
          expected_total: expectedTotal,
          spent: actualSpent,
          remaining: newBalance,
          context: "deductBalance",
        });
      }

      await assertBeneficiaryBalanceInvariant(tx, beneficiary.id, "deductBalance");

      return {
        success: true,
        duplicated: false,
        newBalance,
        beneficiaryId: beneficiary.id,
        notificationId: notification.id,
        transaction: {
          id: transaction.id,
          amount: Number(transaction.amount),
          type: transaction.type,
          created_at: transaction.created_at.toISOString(),
          facility_name: effectiveFacilityName,
        },
      };
    });

    if (!result.duplicated) {
      emitNotification(result.beneficiaryId, {
        id: result.notificationId,
        title: "تم خصم من رصيدك",
        message: `تم خصم ${formatCurrency(Number(amount))} د.ل من رصيدك لدى ${effectiveFacilityName}`,
        amount,
        remaining_balance: result.newBalance,
        created_at: new Date().toISOString(),
        transaction: result.transaction,
      });
    }

    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    return { success: true, newBalance: result.newBalance };
  } catch (error: unknown) {
    logger.error("Deduction error", { error: String(error) });

    const msg = error instanceof Error ? error.message : "";
    const mapDeductionError = (rawMessage: string): string => {
      if (!rawMessage) return "تعذر تنفيذ عملية الخصم";

      const knownArabicMessages = [
        "المستفيد غير موجود",
        "رصيد المستفيد صفر أو مكتمل",
        "حساب المستفيد موقوف ولا يمكن إجراء خصم عليه",
        "يوجد أكثر من سجل بنفس رقم البطاقة. يرجى دمج التكرار أولاً قبل الخصم.",
      ];
      if (knownArabicMessages.includes(rawMessage)) return rawMessage;
      if (rawMessage.startsWith("المبلغ أكبر من الرصيد")) return rawMessage;

      // يظهر عندما لا تتطابق الأرصدة المخزنة مع دفتر الحركات
      if (rawMessage.startsWith("BALANCE_GUARD_INVARIANT_FAILED")) {
        return "فشل التحقق من سلامة الرصيد (عدم تطابق بين الرصيد المخزن والحركات). يلزم مراجعة/إعادة احتساب الأرصدة.";
      }

      // سباق تزامن على idempotency_key (طلب مكرر بنفس requestId)
      if (rawMessage.includes("P2002")) {
        return "تم اكتشاف طلب مكرر أو تعارض تزامن. أعد المحاولة بنفس requestId أو حدّث الصفحة.";
      }

      if (rawMessage.includes("رقم البطاقة") || rawMessage.includes("المبلغ") || rawMessage.includes("المرفق")) {
        return rawMessage;
      }

      return "تعذر تنفيذ عملية الخصم";
    };

    // سجل الخطأ في AuditLog
    let sessionForAudit: Awaited<ReturnType<typeof requireActiveFacilitySession>> | null = null;
    let auditErrorId: string | null = null;
    try {
      sessionForAudit = await requireActiveFacilitySession();
      const audit = await prisma.auditLog.create({
        data: {
          facility_id: sessionForAudit?.id ?? null,
          user: sessionForAudit?.username ?? "anonymous",
          action: "DEDUCT_BALANCE_ERROR",
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error && error.stack ? error.stack : undefined,
            card_number: formData.card_number,
            beneficiary_id: beneficiaryIdInput || undefined,
            amount: formData.amount,
            type: formData.type,
            transactionDate: formData.transactionDate,
            facilityId: formData.facilityId,
            requestId: formData.requestId,
          },
        },
      });
      auditErrorId = audit.id;
    } catch (auditError) {
      logger.error("Failed to write deduction error to audit log", { error: String(auditError) });
    }

    const detailedReason = mapDeductionError(msg);

    // للمشرف: أعرض السبب الحقيقي + مرجع السجل للتتبع السريع
    if (sessionForAudit?.is_admin) {
      const withRef = auditErrorId
        ? `${detailedReason} (مرجع التتبع: ${auditErrorId})`
        : detailedReason;
      return { error: withRef };
    }

    // لغير المشرف: نحافظ على رسالة آمنة، مع مرجع داخلي عند توفره
    const publicMessage = detailedReason === "تعذر تنفيذ عملية الخصم"
      ? (auditErrorId ? `تعذر تنفيذ عملية الخصم (مرجع: ${auditErrorId})` : detailedReason)
      : detailedReason;

    return { error: publicMessage };
  }
}
