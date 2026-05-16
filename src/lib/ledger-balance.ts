import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { roundCurrency } from "@/lib/money";

export async function getLedgerRemainingByBeneficiaryIds(beneficiaryIds: string[]) {
  if (beneficiaryIds.length === 0) return new Map<string, number>();

  const uniqueIds = [...new Set(beneficiaryIds)];
  const totals = await prisma.beneficiary.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, total_balance: true },
  });

  const spentRows = await prisma.$queryRaw<Array<{ beneficiary_id: string; spent: number }>>`
    SELECT beneficiary_id, SUM(COALESCE(actual_company_share, amount))::float8 AS spent
    FROM "Transaction"
    WHERE beneficiary_id IN (${Prisma.join(uniqueIds)})
      AND is_cancelled = false
      AND type NOT IN ('CANCELLATION', 'DENTAL')
    GROUP BY beneficiary_id
  `;

  const spentById = new Map(spentRows.map((row) => [row.beneficiary_id, Number(row.spent ?? 0)]));
  return new Map(
    totals.map((row) => {
      const total = Number(row.total_balance);
      const spent = spentById.get(row.id) ?? 0;
      return [row.id, roundCurrency(Math.max(0, total - spent))] as const;
    })
  );
}

export async function getLedgerRemainingByBeneficiaryId(beneficiaryId: string, totalBalance?: number) {
  if (!beneficiaryId) return 0;

  const balanceTotal =
    typeof totalBalance === "number"
      ? totalBalance
      : Number(
          (
            await prisma.beneficiary.findUnique({
              where: { id: beneficiaryId },
              select: { total_balance: true },
            })
          )?.total_balance ?? 0
        );

  const spentResult = await prisma.$queryRaw<Array<{ spent: number }>>`
    SELECT SUM(COALESCE(actual_company_share, amount))::float8 AS spent
    FROM "Transaction"
    WHERE beneficiary_id = ${beneficiaryId}
      AND is_cancelled = false
      AND type NOT IN ('CANCELLATION', 'DENTAL')
  `;

  const spentAmount = spentResult.length > 0 ? Number(spentResult[0].spent ?? 0) : 0;
  return roundCurrency(Math.max(0, balanceTotal - spentAmount));
}
