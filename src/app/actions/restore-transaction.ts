"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function deleteCancellationTransaction(cancellationId: string) {
  try {
    const session = await getSession();
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

    const amount = Number(cancellationTransaction.amount); // This is negative e.g. -100
    // If we undo the cancellation, we need to DEDUCT the money again.
    // The cancellation added -amount (effectively +100 if we consider remaining balance logic: bal = bal - tx_amount).
    // Wait, the logic used in cancelTransaction was:
    // `newBalance = remaining_balance + amount` (where amount was the positive deduction value).
    // And `cancellationTransaction.amount` is explicitly negative (-amount).
    
    // To revert:
    // 1. Mark original transaction `is_cancelled = false`
    // 2. Reduce the beneficiary balance by `amount` (the positive value).
    // cancellationTransaction.amount is e.g. -100.
    // So if we just delete it, we effectivelly revert the balance change it caused? No, we updated the balance separately.
    
    // Logic to revert:
    // original amount: 100.
    // cancel: bal += 100. cancellation tx: -100.
    // revert cancel: bal -= 100. original tx: is_cancelled=false. delete cancellation tx.

    const refundAmountReversed = Math.abs(amount); // 100

    await prisma.$transaction(async (tx) => {
      // 1. Mark original transaction as valid (not cancelled)
      await tx.transaction.update({
        where: { id: cancellationTransaction.original_transaction_id! },
        data: { is_cancelled: false },
      });

      // 2. Update beneficiary balance (Re-deduct amount)
      const currentBalance = Number(cancellationTransaction.beneficiary.remaining_balance);
      const newBalance = currentBalance - refundAmountReversed;
      // Check if balance goes negative - allowed? Usually yes if it was valid before.
      
      const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

      await tx.beneficiary.update({
        where: { id: cancellationTransaction.beneficiary_id },
        data: {
          remaining_balance: newBalance,
          status: newStatus,
        },
      });

      // 3. Delete the cancellation transaction
      await tx.transaction.delete({
        where: { id: cancellationId },
      });

      // 4. Audit Log
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
    console.error("Revert cancellation error:", error);
    return { error: "فشل في التراجع عن الإلغاء" };
  }
}
