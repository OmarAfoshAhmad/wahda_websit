import { roundCurrency } from "@/lib/money";
import { logger } from "@/lib/logger";
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

export async function calculateBeneficiaryBalance(
  tx: TxClient,
  beneficiaryId: string
): Promise<{ remaining_balance: number; total_balance: number; status: "ACTIVE" | "FINISHED" | "SUSPENDED"; name: string; card_number: string }> {
  const beneficiary = await tx.beneficiary.findUnique({
    where: { id: beneficiaryId },
    select: {
      id: true,
      name: true,
      card_number: true,
      total_balance: true,
      status: true,
    },
  });

  if (!beneficiary) {
    throw new Error("BENEFICIARY_NOT_FOUND");
  }

  const txns = await tx.transaction.findMany({
    where: {
      beneficiary_id: beneficiaryId,
      is_cancelled: false,
      type: { notIn: ["CANCELLATION", "DENTAL", "OPTICS"] }, // DENTAL and OPTICS don't affect balance
    },
    select: { amount: true, actual_company_share: true },
  });

  const total = Number(beneficiary.total_balance);
  const ledgerSpent = roundCurrency(
    txns.reduce((sum, t) => sum + Number(t.actual_company_share ?? t.amount ?? 0), 0)
  );
  const computedRemaining = roundCurrency(Math.max(0, total - ledgerSpent));
  const shouldStatus = expectedStatus(beneficiary.status, computedRemaining);

  return {
    remaining_balance: computedRemaining,
    total_balance: total,
    status: shouldStatus,
    name: beneficiary.name,
    card_number: beneficiary.card_number,
  };
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
      remaining_balance: true,
      status: true,
    },
  });

  if (!beneficiary) {
    throw new Error("BALANCE_GUARD_BENEFICIARY_NOT_FOUND");
  }

  const { remaining_balance: computedRemaining, status: shouldStatus, total_balance: total } = await calculateBeneficiaryBalance(tx, beneficiaryId);
  const storedRemaining = Number(beneficiary.remaining_balance);

  const sameRemaining = roundCurrency(storedRemaining) === computedRemaining;
  const sameStatus = beneficiary.status === shouldStatus;

  if (!sameRemaining || !sameStatus) {
    logger.warn("BALANCE_GUARD_INVARIANT_MISMATCH", {
      context,
      beneficiary_id: beneficiary.id,
      stored_remaining: storedRemaining,
      computed_remaining: computedRemaining,
      status: beneficiary.status,
      expected_status: shouldStatus,
      total_balance: total,
    });
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
