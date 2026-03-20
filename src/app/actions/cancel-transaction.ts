"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function cancelTransaction(transactionId: string) {
  try {
    const session = await getSession();
    if (!session || !session.is_admin) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { beneficiary: true },
    });

    if (!transaction) {
      return { error: "المعاملة غير موجودة" };
    }

    if (transaction.is_cancelled) {
      return { error: "المعاملة ملغاة بالفعل" };
    }

    if (transaction.type === "CANCELLATION") {
      return { error: "لا يمكن إلغاء معاملة إلغاء" };
    }

    const amount = Number(transaction.amount);

    await prisma.$transaction(async (tx) => {
      // 1. Mark original transaction as cancelled
      await tx.transaction.update({
        where: { id: transactionId },
        data: { is_cancelled: true },
      });

      // 2. Update beneficiary balance (Refund amount)
      // Since original transaction deducted amount, we add it back.
      const newBalance = Number(transaction.beneficiary.remaining_balance) + amount;
      
      // Update status if needed (e.g. if balance becomes positive again, status = ACTIVE)
      // Assuming initial balance is > 0. If balance > 0, ACTIVE.
      const newStatus = newBalance > 0 ? "ACTIVE" : "FINISHED"; 
      // Actually, logic for status might be simpler: if balance > 0, ACTIVE.

      await tx.beneficiary.update({
        where: { id: transaction.beneficiary_id },
        data: {
          remaining_balance: newBalance,
          status: "ACTIVE", // Always active if we refund money usually
        },
      });

      // 3. Create new cancellation transaction
      // We use NEGATIVE amount to represent refund in reports so sums are correct?
      // Or consistent positive amount but type CANCELLATION?
      // If we use positive amount for CANCELLATION, then sum(amount) will be 2x.
      // So meaningful accounting requires negative amount or type-based logic.
      // Let's use negative amount for CANCELLATION type transactions to keep sums correct.
      await tx.transaction.create({
        data: {
          beneficiary_id: transaction.beneficiary_id,
          facility_id: session.id, // Or original facility? Usually the admin (current user) cancels it.
          amount: -amount, // Negative to offset
          type: "CANCELLATION",
          is_cancelled: false, // This transaction itself is executed (it's a cancellation action)
          original_transaction_id: transactionId,
        },
      });

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "CANCEL_TRANSACTION",
          metadata: {
            original_transaction_id: transactionId,
            refunded_amount: amount,
            beneficiary_card: transaction.beneficiary.card_number,
          },
        },
      });
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    
    return { success: true };
  } catch (error) {
    console.error("Cancellation error:", error);
    return { error: "فشل في إلغاء المعاملة" };
  }
}
