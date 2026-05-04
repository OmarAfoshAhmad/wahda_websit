import prisma from "@/lib/prisma";
import { INTERACTIVE_TX_OPTIONS } from "./constants";
import { DeletedImportTransactionSnapshot, ImportTxRow } from "./types";

export async function cleanupActiveImportsAndRestoreLedgerState(): Promise<{
  deletedImportTransactions: number;
  cancelledImportTransactions: number;
  affectedMemberIds: string[];
  deletedImportTransactionRows: DeletedImportTransactionSnapshot[];
}> {
  return await prisma.$transaction(async (tx) => {
    const existingImportRows = await tx.$queryRaw<ImportTxRow[]>`
      SELECT
        id,
        beneficiary_id,
        facility_id,
        amount::float8 AS amount,
        type::text AS type,
        is_cancelled,
        created_at,
        original_transaction_id,
        idempotency_key
      FROM "Transaction"
      WHERE type = 'IMPORT'
      ORDER BY created_at ASC, id ASC
    `;

    const deletedImportTransactionRows: DeletedImportTransactionSnapshot[] = existingImportRows.map((row) => ({
      id: row.id,
      beneficiaryId: row.beneficiary_id,
      facilityId: row.facility_id,
      amount: Number(row.amount) || 0,
      type: "IMPORT",
      isCancelled: Boolean(row.is_cancelled),
      createdAt: row.created_at.toISOString(),
      originalTransactionId: row.original_transaction_id,
      idempotencyKey: row.idempotency_key,
    }));

    if (deletedImportTransactionRows.length > 0) {
      await tx.transaction.deleteMany({
        where: {
          id: { in: deletedImportTransactionRows.map((t) => t.id) },
        },
      });
    }

    return {
      deletedImportTransactions: deletedImportTransactionRows.length,
      cancelledImportTransactions: deletedImportTransactionRows.length,
      affectedMemberIds: Array.from(new Set(deletedImportTransactionRows.map((t) => t.beneficiaryId))),
      deletedImportTransactionRows,
    };
  }, INTERACTIVE_TX_OPTIONS);
}

export async function cleanupAutoSettlementsAndRestoreLedgerState(): Promise<{
  deletedSettlementTransactions: number;
  deletedCancelledSettlementTransactions: number;
  affectedMemberIds: string[];
}> {
  return await prisma.$transaction(async (tx) => {
    const settlementRows = await tx.$queryRaw<Array<{ id: string; is_cancelled: boolean; beneficiary_id: string }>>`
      SELECT t.id, t.is_cancelled, t.beneficiary_id
      FROM "Transaction" t
      WHERE t.type::text = 'SETTLEMENT'
    `;

    const deletedCancelledSettlementTransactions = settlementRows.filter((row) => Boolean(row.is_cancelled)).length;

    if (settlementRows.length > 0) {
      await tx.transaction.deleteMany({
        where: {
          id: { in: settlementRows.map((row) => row.id) },
        },
      });
    }

    return {
      deletedSettlementTransactions: settlementRows.length,
      deletedCancelledSettlementTransactions,
      affectedMemberIds: Array.from(new Set(settlementRows.map((row) => row.beneficiary_id))),
    };
  }, INTERACTIVE_TX_OPTIONS);
}

export async function recalculateBeneficiariesLedgerState(memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;

  await prisma.$executeRaw`
    WITH deduction AS (
      SELECT
        t.beneficiary_id,
        COALESCE(SUM(t.amount), 0)::numeric AS deducted
      FROM "Transaction" t
      WHERE t.beneficiary_id = ANY(${memberIds}::text[])
        AND t.is_cancelled = false
        AND t.type <> 'CANCELLATION'
      GROUP BY t.beneficiary_id
    )
    UPDATE "Beneficiary" b
    SET
      remaining_balance = ROUND(LEAST(b.total_balance, GREATEST(0::numeric, b.total_balance - COALESCE(d.deducted, 0::numeric))), 2),
      status = CASE
        WHEN ROUND(LEAST(b.total_balance, GREATEST(0::numeric, b.total_balance - COALESCE(d.deducted, 0::numeric))), 2) <= 0
          THEN 'FINISHED'::"BeneficiaryStatus"
        ELSE 'ACTIVE'::"BeneficiaryStatus"
      END,
      completed_via = CASE
        WHEN ROUND(LEAST(b.total_balance, GREATEST(0::numeric, b.total_balance - COALESCE(d.deducted, 0::numeric))), 2) <= 0
          THEN 'DEDUCTION'
        ELSE NULL
      END
    FROM deduction d
    WHERE b.id = ANY(${memberIds}::text[])
      AND b.id = d.beneficiary_id
  `;

  await prisma.$executeRaw`
    UPDATE "Beneficiary" b
    SET
      remaining_balance = ROUND(GREATEST(0::numeric, b.total_balance), 2),
      status = CASE
        WHEN ROUND(GREATEST(0::numeric, b.total_balance), 2) <= 0
          THEN 'FINISHED'::"BeneficiaryStatus"
        ELSE 'ACTIVE'::"BeneficiaryStatus"
      END,
      completed_via = CASE
        WHEN ROUND(GREATEST(0::numeric, b.total_balance), 2) <= 0
          THEN 'DEDUCTION'
        ELSE NULL
      END
    WHERE b.id = ANY(${memberIds}::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM "Transaction" t
        WHERE t.beneficiary_id = b.id
          AND t.is_cancelled = false
          AND t.type <> 'CANCELLATION'
      )
  `;
}
