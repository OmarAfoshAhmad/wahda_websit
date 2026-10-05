import { roundCurrency } from "@/lib/money";
import prisma from "@/lib/prisma";
import { assertBeneficiaryBalanceInvariant, settleBeneficiaryBalance } from "@/lib/tx-balance-guard";

type TxClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * نواة إلغاء حركة مالية داخل معاملة قائمة: قفل الحركة والمستفيد، تعليم الحركة ملغاة، إعادة حساب الرصيد من الدفتر،
 * وإنشاء حركة إلغاء عاكسة للسقف. يستخدمها إلغاء الحركات العام وإلغاء صرف الصيدلية حتى لا يتكرر منطق المحاسبة.
 * ترمي TX_NOT_FOUND أو TX_ALREADY_CANCELLED أو TX_IS_CANCELLATION.
 */
export async function cancelTransactionInTx(tx: TxClient, transactionId: string, actor: { id: string; username: string }) {
  // 1. قفل الحركة أولاً بحزم لمنع ثغرة TOCTOU والاسترجاع المزدوج
  const lockedTx = await tx.$queryRaw<Array<{ is_cancelled: boolean; type: string }>>`
    SELECT is_cancelled, type FROM "Transaction"
    WHERE id = ${transactionId}
    FOR UPDATE
  `;

  if (lockedTx.length === 0) {
    throw new Error("TX_NOT_FOUND");
  }

  if (lockedTx[0].is_cancelled) {
    throw new Error("TX_ALREADY_CANCELLED");
  }

  if (lockedTx[0].type === "CANCELLATION") {
    throw new Error("TX_IS_CANCELLATION");
  }

  // القراءة الآن آمنة تماماً لأن الحركة مقفلة باسم هذا الـ Request
  const transaction = await tx.transaction.findUnique({
    where: { id: transactionId },
    include: { beneficiary: true },
  });

  if (!transaction) {
    throw new Error("TX_NOT_FOUND");
  }

  const amount = Number(transaction.amount);

  // 1. قفل صف المستفيد لمنع race condition
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Beneficiary"
    WHERE id = ${transaction.beneficiary_id}
    FOR UPDATE
  `;

  if (locked.length === 0) {
    throw new Error("المستفيد غير موجود");
  }

  // 2. Mark original transaction as cancelled
  await tx.transaction.update({
    where: { id: transactionId },
    data: { is_cancelled: true },
  });

  // 3. الرصيد يُعاد حسابه من الدفتر؛ الخدمات المعزولة (أسنان/بصريات/علاج طبيعي) لا تغيّره.
  const settled = await settleBeneficiaryBalance(tx, transaction.beneficiary_id);
  const currentBalance = settled.balanceBefore;
  const newBalance = settled.balanceAfter;
  const refundAmount = roundCurrency(newBalance - currentBalance);

  // 4. Create cancellation transaction (reverse TPA ceiling as well)
  const cancellationData: Record<string, unknown> = {
    beneficiary_id: transaction.beneficiary_id,
    facility_id: actor.id,
    amount: -amount,
    type: "CANCELLATION",
    is_cancelled: false,
    original_transaction_id: transactionId,
  };
  // If original had TPA data, copy it to reverse ceiling consumption
  if (transaction.company_id) {
    cancellationData.company_id = transaction.company_id;
    cancellationData.service_category = transaction.service_category;
    cancellationData.ceiling_consumed = transaction.ceiling_consumed
      ? -Number(transaction.ceiling_consumed)
      : 0;
    cancellationData.remaining_ceiling_before = null; // will be recalculated on next deduction
    cancellationData.remaining_ceiling_after = null;
  }
  const cancellationTx = await tx.transaction.create({
    data: cancellationData as any,
  });


  // 5. Audit Log — مع تسجيل الرصيد قبل وبعد
  await tx.auditLog.create({
    data: {
      facility_id: actor.id,
      user: actor.username,
      action: "CANCEL_TRANSACTION",
      metadata: {
        original_transaction_id: transactionId,
        beneficiary_name: transaction.beneficiary.name,
        cancelled_amount: amount,
        refunded_amount: refundAmount,
        balance_before: currentBalance,
        balance_after: newBalance,
        card_number: transaction.beneficiary.card_number,
      },
    },
  });

  await assertBeneficiaryBalanceInvariant(tx, transaction.beneficiary_id, "cancelTransaction");

  return {
    cancellationId: cancellationTx.id,
    details: {
      transaction_id: transactionId,
      cancellation_transaction_id: cancellationTx.id,
      beneficiary_name: String(transaction.beneficiary.name),
      card_number: String(transaction.beneficiary.card_number),
      amount,
      balance_before: currentBalance,
      balance_after: newBalance,
    },
  };
}
