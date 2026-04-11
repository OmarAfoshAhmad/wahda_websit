"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { roundCurrency } from "@/lib/money";

import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

export async function deleteCancellationTransaction(cancellationId: string) {
  try {
    const session = await requireActiveFacilitySession();
    if (!session || !hasPermission(session, 'correct_transactions')) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    // FIX TOCTOU: نقرأ الحركة داخل الـ Transaction لمنع تغير البيانات بين القراءة والقفل
    await prisma.$transaction(async (tx) => {
      const cancellationTransaction = await tx.transaction.findUnique({
        where: { id: cancellationId },
        select: {
          id: true,
          type: true,
          beneficiary_id: true,
          original_transaction_id: true,
          amount: true,
          beneficiary: { select: { card_number: true } },
        },
      });

      if (!cancellationTransaction) {
        throw new Error("CANCELLATION_NOT_FOUND");
      }

      if (cancellationTransaction.type !== "CANCELLATION") {
        throw new Error("NOT_CANCELLATION");
      }

      if (!cancellationTransaction.original_transaction_id) {
        throw new Error("NO_ORIGINAL_TRANSACTION");
      }

      const refundAmountReversed = Math.abs(Number(cancellationTransaction.amount));

      // 1. قفل صف المستفيد لمنع race condition
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string }>>`
        SELECT id, remaining_balance, status FROM "Beneficiary"
        WHERE id = ${cancellationTransaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const currentBalance = Number(locked[0].remaining_balance);
      const lockedStatus = locked[0].status;
      const newBalance = roundCurrency(currentBalance - refundAmountReversed);
      // FIX: احترام حالة الإيقاف — لا نغير SUSPENDED إلى ACTIVE أو FINISHED
      const newStatus = lockedStatus === "SUSPENDED" ? "SUSPENDED" : (newBalance <= 0 ? "FINISHED" : "ACTIVE");

      // 2. Mark original transaction as valid (not cancelled)
      await tx.transaction.update({
        where: { id: cancellationTransaction.original_transaction_id! },
        data: { is_cancelled: false },
      });

      // 3. Update beneficiary balance with locked value
      await tx.beneficiary.update({
        where: { id: cancellationTransaction.beneficiary_id },
        data: {
          remaining_balance: newBalance,
          status: newStatus,
        },
      });

      // 4. SEC-FIX: إلغاء حركة الإلغاء بدل حذفها نهائياً — للحفاظ على سلسلة الأثر المالية
      await tx.transaction.update({
        where: { id: cancellationId },
        data: { is_cancelled: true },
      });

      // 5. Audit Log — مع تسجيل الرصيد قبل وبعد
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "REVERT_CANCELLATION",
          metadata: {
            cancellation_transaction_id: cancellationId,
            original_transaction_id: cancellationTransaction.original_transaction_id,
            re_deducted_amount: refundAmountReversed,
            card_number: cancellationTransaction.beneficiary.card_number,
            balance_before: currentBalance,
            balance_after: newBalance,
          },
        },
      });
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");

    return { success: true };

  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "CANCELLATION_NOT_FOUND") return { error: "معاملة الإلغاء غير موجودة" };
    if (msg === "NOT_CANCELLATION") return { error: "هذه المعاملة ليست معاملة إلغاء" };
    if (msg === "NO_ORIGINAL_TRANSACTION") return { error: "لا يوجد معرف للمعاملة الأصلية" };
    logger.error("Revert cancellation error", { error: String(error) });
    return { error: "فشل في التراجع عن الإلغاء" };
  }
}
