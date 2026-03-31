"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

export async function cancelTransaction(transactionId: string) {
  try {
    const session = await requireActiveFacilitySession();
    if (!session || !hasPermission(session, 'cancel_transactions')) {
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
      // 1. قفل صف المستفيد لمنع race condition
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number }>>`
        SELECT id, remaining_balance FROM "Beneficiary"
        WHERE id = ${transaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const currentBalance = Number(locked[0].remaining_balance);
      const newBalance = currentBalance + amount;

      // 2. Mark original transaction as cancelled
      await tx.transaction.update({
        where: { id: transactionId },
        data: { is_cancelled: true },
      });

      // 3. Update beneficiary balance with locked value
      await tx.beneficiary.update({
        where: { id: transaction.beneficiary_id },
        data: {
          remaining_balance: newBalance,
          status: "ACTIVE",
        },
      });

      // 4. Create cancellation transaction
      await tx.transaction.create({
        data: {
          beneficiary_id: transaction.beneficiary_id,
          facility_id: session.id,
          amount: -amount,
          type: "CANCELLATION",
          is_cancelled: false,
          original_transaction_id: transactionId,
        },
      });

      // 5. Audit Log
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
    logger.error("Cancellation error", { error: String(error) });
    return { error: "فشل في إلغاء المعاملة" };
  }
}
