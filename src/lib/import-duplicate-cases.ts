import { TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";

export type ImportDuplicateCase = {
  beneficiaryId: string;
  name: string;
  cardNumber: string;
  importCount: number;
  currentRemaining: number;
  extraAmount: number;
  fixedRemaining: number;
  currentStatus: "ACTIVE" | "FINISHED" | "SUSPENDED";
  fixedStatus: "ACTIVE" | "FINISHED";
  keepTransactionId: string;
  deleteTransactionIds: string[];
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function getActiveImportDuplicateCases(): Promise<ImportDuplicateCase[]> {
  const duplicateRows = await prisma.$queryRaw<Array<{ beneficiary_id: string; cnt: number }>>`
    SELECT beneficiary_id, COUNT(*)::int AS cnt
    FROM "Transaction"
    WHERE type = 'IMPORT' AND is_cancelled = false
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  `;

  if (duplicateRows.length === 0) return [];

  const beneficiaryIds = duplicateRows.map((row) => row.beneficiary_id);

  const beneficiaries = await prisma.beneficiary.findMany({
    where: { id: { in: beneficiaryIds } },
    select: {
      id: true,
      name: true,
      card_number: true,
      remaining_balance: true,
      status: true,
    },
  });

  const transactions = await prisma.transaction.findMany({
    where: {
      beneficiary_id: { in: beneficiaryIds },
      type: TransactionType.IMPORT,
      is_cancelled: false,
    },
    select: {
      id: true,
      beneficiary_id: true,
      amount: true,
      created_at: true,
    },
    orderBy: [{ beneficiary_id: "asc" }, { created_at: "asc" }],
  });

  const txByBeneficiary = new Map<string, typeof transactions>();
  for (const tx of transactions) {
    const arr = txByBeneficiary.get(tx.beneficiary_id) ?? [];
    arr.push(tx);
    txByBeneficiary.set(tx.beneficiary_id, arr);
  }

  const beneficiaryMap = new Map(beneficiaries.map((b) => [b.id, b]));

  const result: ImportDuplicateCase[] = [];
  for (const row of duplicateRows) {
    const beneficiary = beneficiaryMap.get(row.beneficiary_id);
    if (!beneficiary) continue;

    const txs = txByBeneficiary.get(row.beneficiary_id) ?? [];
    if (txs.length <= 1) continue;

    const keepTx = txs[0];
    const deleteTxs = txs.slice(1);
    const extraAmount = round2(deleteTxs.reduce((sum, tx) => sum + Number(tx.amount), 0));
    const currentRemaining = round2(Number(beneficiary.remaining_balance));
    const fixedRemaining = round2(currentRemaining + extraAmount);
    const fixedStatus = fixedRemaining <= 0 ? "FINISHED" : "ACTIVE";

    result.push({
      beneficiaryId: beneficiary.id,
      name: beneficiary.name,
      cardNumber: beneficiary.card_number,
      importCount: txs.length,
      currentRemaining,
      extraAmount,
      fixedRemaining,
      currentStatus: beneficiary.status,
      fixedStatus,
      keepTransactionId: keepTx.id,
      deleteTransactionIds: deleteTxs.map((tx) => tx.id),
    });
  }

  result.sort((a, b) => b.extraAmount - a.extraAmount);
  return result;
}

export async function applyActiveImportDuplicateFix(params: { user: string; facilityId?: string | null }) {
  const cases = await getActiveImportDuplicateCases();

  if (cases.length === 0) {
    return {
      affectedBeneficiaries: 0,
      removedTransactions: 0,
      totalExtraAmount: 0,
    };
  }

  let removedTransactions = 0;

  await prisma.$transaction(async (tx) => {
    for (const item of cases) {
      if (item.deleteTransactionIds.length === 0) continue;

      await tx.transaction.deleteMany({
        where: { id: { in: item.deleteTransactionIds } },
      });
      removedTransactions += item.deleteTransactionIds.length;

      await tx.beneficiary.update({
        where: { id: item.beneficiaryId },
        data: {
          remaining_balance: item.fixedRemaining,
          status: item.fixedStatus,
          completed_via: item.fixedStatus === "FINISHED" ? "IMPORT" : null,
        },
      });
    }
  });

  const totalExtraAmount = round2(cases.reduce((sum, item) => sum + item.extraAmount, 0));

  await prisma.auditLog.create({
    data: {
      facility_id: params.facilityId ?? undefined,
      user: params.user,
      action: "FIX_DUPLICATE_IMPORT_TRANSACTIONS_BATCH",
      metadata: {
        affectedBeneficiaries: cases.length,
        removedTransactions,
        totalExtraAmount,
      },
    },
  });

  return {
    affectedBeneficiaries: cases.length,
    removedTransactions,
    totalExtraAmount,
  };
}
