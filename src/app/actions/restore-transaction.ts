"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

import { requireActiveFacilitySession } from "@/lib/session-guard";

export async function deleteCancellationTransaction(cancellationId: string) {
  try {
    const session = await requireActiveFacilitySession();
    if (!session || !session.is_admin) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    const cancellationTransaction = await prisma.transaction.findUnique({
      where: { id: cancellationId },
      include: { beneficiary: true },
    });

    if (!cancellationTransaction) {
      return { error: "معاملة الإلغاء غير موجودة" };
    }

    if (cancellationTransaction.type !== "CANCELLATION") {
      return { error: "هذه المعاملة ليست معاملة إلغاء" };
    }

    if (!cancellationTransaction.original_transaction_id) {
      return { error: "لا يوجد معرف للمعاملة الأصلية" };
    }

    const refundAmountReversed = Math.abs(Number(cancellationTransaction.amount));

    await prisma.$transaction(async (tx) => {
      // 1. قفل صف المستفيد لمنع race condition
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number }>>`
        SELECT id, remaining_balance FROM "Beneficiary"
        WHERE id = ${cancellationTransaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const currentBalance = Number(locked[0].remaining_balance);
      const newBalance = currentBalance - refundAmountReversed;
      const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

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

      // 4. Delete the cancellation transaction
      await tx.transaction.delete({
        where: { id: cancellationId },
      });

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "REVERT_CANCELLATION",
          metadata: {
            cancellation_transaction_id: cancellationId,
            original_transaction_id: cancellationTransaction.original_transaction_id,
            re_deducted_amount: refundAmountReversed,
          },
        },
      });
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    
    return { success: true };

  } catch (error) {
    logger.error("Revert cancellation error", { error: String(error) });
    return { error: "فشل في التراجع عن الإلغاء" };
  }
}
