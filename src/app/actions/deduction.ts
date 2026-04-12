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

export async function deductBalance(formData: {
  card_number: string;
  amount: number;
  type: "MEDICINE" | "SUPPLIES";
  transactionDate?: Date;
  facilityId?: string;
}) {
  const session = await requireActiveFacilitySession();
  if (!session || (session.is_manager && !hasPermission(session, "deduct_balance"))) {
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

  const validated = deductionSchema.safeParse({
    ...formData,
    card_number: normalizedCard,
  });
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { card_number, amount, type } = validated.data;
  const manualTransactionDate =
    formData.transactionDate instanceof Date && !Number.isNaN(formData.transactionDate.getTime())
      ? formData.transactionDate
      : null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Get beneficiary with row-level lock (using raw sql as Prisma interactive tx isn't always enough for specific locking locks)
      // On PostgreSQL, we can use SELECT ... FOR UPDATE
      const beneficiaries = await tx.$queryRaw<Array<{ id: string; name: string; remaining_balance: number; status: string }>>`
        SELECT id, name, remaining_balance, status FROM "Beneficiary" 
        WHERE UPPER(BTRIM(card_number)) = UPPER(BTRIM(${card_number}))
        AND "deleted_at" IS NULL
        LIMIT 1 
        FOR UPDATE
      `;

      if (beneficiaries.length === 0) {
        throw new Error("المستفيد غير موجود");
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

      return {
        success: true,
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

    emitNotification(result.beneficiaryId, {
      id: result.notificationId,
      title: "تم خصم من رصيدك",
      message: `تم خصم ${formatCurrency(Number(amount))} د.ل من رصيدك لدى ${effectiveFacilityName}`,
      amount,
      remaining_balance: result.newBalance,
      created_at: new Date().toISOString(),
      transaction: result.transaction,
    });

    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    return { success: true, newBalance: result.newBalance };
  } catch (error: unknown) {
    logger.error("Deduction error", { error: String(error) });
    // Only expose known safe messages thrown by our own code
    const knownErrors = [
      "المستفيد غير موجود",
      "رصيد المستفيد صفر أو مكتمل",
      "حساب المستفيد موقوف ولا يمكن إجراء خصم عليه",
    ];
    const msg = error instanceof Error ? error.message : "";
    const safeMsg = knownErrors.includes(msg) || msg.startsWith("المبلغ أكبر من الرصيد")
      ? msg
      : "تعذر تنفيذ عملية الخصم";
    return { error: safeMsg };
  }
}
