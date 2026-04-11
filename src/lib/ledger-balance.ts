import prisma from "@/lib/prisma";
import { roundCurrency } from "@/lib/money";

export async function getLedgerRemainingByBeneficiaryIds(beneficiaryIds: string[]) {
  if (beneficiaryIds.length === 0) return new Map<string, number>();

  const uniqueIds = [...new Set(beneficiaryIds)];
  const [totals, spentRows] = await Promise.all([
    prisma.beneficiary.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, total_balance: true },
    }),
    prisma.transaction.groupBy({
      by: ["beneficiary_id"],
      where: {
        beneficiary_id: { in: uniqueIds },
        is_cancelled: false,
        type: { not: "CANCELLATION" },
      },
      _sum: { amount: true },
    }),
  ]);

  const spentById = new Map(spentRows.map((row) => [row.beneficiary_id, Number(row._sum.amount ?? 0)]));
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

  const spent = await prisma.transaction.aggregate({
    where: {
      beneficiary_id: beneficiaryId,
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    _sum: { amount: true },
  });

  return roundCurrency(Math.max(0, balanceTotal - Number(spent._sum.amount ?? 0)));
}
