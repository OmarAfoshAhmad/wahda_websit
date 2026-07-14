import { roundCurrency } from "@/lib/money";
import prisma from "@/lib/prisma";

type TxClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export function buildIdempotencyKey(scope: string, actorId: string, requestId?: string | null): string | null {
  const normalizedScope = (scope ?? "").trim();
  const normalizedActor = (actorId ?? "").trim();
  const normalizedRequest = (requestId ?? "").trim();

  if (!normalizedScope || !normalizedActor || !normalizedRequest) {
    return null;
  }

  return `${normalizedScope}:${normalizedActor}:${normalizedRequest}`;
}

function expectedStatus(currentStatus: "ACTIVE" | "FINISHED" | "SUSPENDED", expectedRemaining: number) {
  if (currentStatus === "SUSPENDED") return "SUSPENDED";
  return expectedRemaining <= 0 ? "FINISHED" : "ACTIVE";
}

export async function assertBeneficiaryBalanceInvariant(
  tx: TxClient,
  beneficiaryId: string,
  context: string,
) {
  const beneficiary = await tx.beneficiary.findUnique({
    where: { id: beneficiaryId },
    select: {
      id: true,
      name: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
    },
  });

  if (!beneficiary) {
    throw new Error("BALANCE_GUARD_BENEFICIARY_NOT_FOUND");
  }

  const spent = await tx.transaction.aggregate({
    where: {
      beneficiary_id: beneficiaryId,
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    _sum: { amount: true },
  });

  const total = Number(beneficiary.total_balance);
  const storedRemaining = Number(beneficiary.remaining_balance);
  const ledgerSpent = Number(spent._sum.amount ?? 0);
  const computedRemaining = roundCurrency(Math.max(0, total - ledgerSpent));
  const shouldStatus = expectedStatus(beneficiary.status, computedRemaining);

  const sameRemaining = roundCurrency(storedRemaining) === computedRemaining;
  const sameStatus = beneficiary.status === shouldStatus;

  if (!sameRemaining || !sameStatus) {
    throw new Error(
      `BALANCE_GUARD_INVARIANT_FAILED|${context}|${beneficiary.id}|stored=${storedRemaining}|computed=${computedRemaining}|status=${beneficiary.status}|expectedStatus=${shouldStatus}`,
    );
  }
}

export async function assertBeneficiariesBalanceInvariant(
  tx: TxClient,
  beneficiaryIds: string[],
  context: string,
) {
  const uniqueIds = [...new Set(beneficiaryIds.filter(Boolean))];
  for (const id of uniqueIds) {
    await assertBeneficiaryBalanceInvariant(tx, id, context);
  }
}
