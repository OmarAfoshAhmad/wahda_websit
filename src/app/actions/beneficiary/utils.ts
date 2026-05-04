import { TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { 
  normalizeCardNumber, 
  canonicalizeCardNumber, 
  leadingZeroScoreAfterPrefix, 
  extractBaseCard 
} from "@/lib/normalize";
export { normalizeCardNumber, canonicalizeCardNumber, leadingZeroScoreAfterPrefix, extractBaseCard };
import { roundCurrency } from "@/lib/money";

// تم حذف normalizeCardNumber, canonicalizeCardNumber, leadingZeroScoreAfterPrefix وتصديرها من lib/normalize.ts

export async function findCanonicalDuplicate(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  inputCard: string,
  excludeId?: string,
) {
  const normalizedInput = normalizeCardNumber(inputCard);
  return tx.beneficiary.findFirst({
    where: {
      deleted_at: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      card_number: { equals: normalizedInput, mode: "insensitive" },
    },
    select: { id: true, card_number: true },
  });
}

export async function ensureCardNumberAvailability(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  cardNumber: string,
  excludeId?: string,
) {
  const normalized = normalizeCardNumber(cardNumber);

  const activeDuplicate = await tx.beneficiary.findFirst({
    where: {
      deleted_at: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      card_number: { equals: normalized, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (activeDuplicate) {
    throw new Error("CARD_EXISTS");
  }

  const deletedDuplicates = await tx.beneficiary.findMany({
    where: {
      deleted_at: { not: null },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      card_number: { equals: normalized, mode: "insensitive" },
    },
    select: { id: true },
  });

  for (const dd of deletedDuplicates) {
    const newCardName = `${normalized}_DEL_${Date.now()}_${dd.id.slice(-4)}`;
    await tx.beneficiary.update({
      where: { id: dd.id },
      data: { card_number: newCardName },
    });
  }
}

export function parseBirthDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function extractFamilyBaseCard(cardNumber: string): string {
  return extractBaseCard(String(cardNumber || ""));
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function familySuffixRegex(baseCard: string): string {
  return `^${escapeRegex(baseCard)}[WSDMFHV][0-9]*$`;
}

export function chooseRemainderRecipientIndex(
  recipients: Array<{ status: string; availableBalance: number }>,
  remainder: number,
): number {
  if (recipients.length === 0) return 0;
  if (remainder <= 0) return 0;

  let bestIndex = 0;
  let bestIsActive = false;
  let bestHasBalance = false;
  let bestBalance = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const isActive = recipient.status === "ACTIVE";
    const balance = Number(recipient.availableBalance ?? 0);
    const hasBalance = balance > 0;

    if (
      (isActive && hasBalance && !(bestIsActive && bestHasBalance)) ||
      (isActive === bestIsActive && hasBalance && !bestHasBalance) ||
      (isActive === bestIsActive && hasBalance === bestHasBalance && balance > bestBalance)
    ) {
      bestIsActive = isActive;
      bestHasBalance = hasBalance;
      bestBalance = balance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function groupIdsBySource(rows: Array<{ id: string; beneficiary_id: string }>) {
  const bySource = new Map<string, string[]>();
  for (const row of rows) {
    const arr = bySource.get(row.beneficiary_id) ?? [];
    arr.push(row.id);
    bySource.set(row.beneficiary_id, arr);
  }
  return [...bySource.entries()].map(([from_beneficiary_id, ids]) => ({ from_beneficiary_id, ids }));
}

export type MergeStrategy = "ZERO_PRIORITY" | "LOWEST_BALANCE" | "HIGHEST_TRANSACTIONS";

export function pickKeepByStrategy(
  matches: Array<{ id: string; card_number: string; remaining_balance: number; tx_count?: number }>,
  strategy: MergeStrategy,
  fallbackKeepId?: string,
) {
  if (matches.length === 0) return null;

  if (fallbackKeepId && matches.some((m) => m.id === fallbackKeepId)) {
    return matches.find((m) => m.id === fallbackKeepId) ?? matches[0];
  }

  if (strategy === "LOWEST_BALANCE") {
    return [...matches].sort((a, b) => Number(a.remaining_balance) - Number(b.remaining_balance))[0];
  }

  if (strategy === "HIGHEST_TRANSACTIONS") {
    return [...matches].sort((a, b) => (b.tx_count ?? 0) - (a.tx_count ?? 0))[0];
  }

  const maxZeroScore = Math.max(...matches.map((m) => leadingZeroScoreAfterPrefix(m.card_number)));
  return (
    matches.find((m) => leadingZeroScoreAfterPrefix(m.card_number) === maxZeroScore) ??
    matches[0]
  );
}

export async function recalculateBeneficiaryRemainingFromTransactions(
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  beneficiaryId: string,
) {
  const beneficiary = await tx.beneficiary.findUnique({
    where: { id: beneficiaryId },
    select: { id: true, total_balance: true, status: true, completed_via: true },
  });
  if (!beneficiary) return;

  const activeTransactions = await tx.transaction.aggregate({
    where: {
      beneficiary_id: beneficiaryId,
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    _sum: { amount: true },
  });

  const spent = Number(activeTransactions._sum.amount ?? 0);
  const totalBalance = Number(beneficiary.total_balance);
  const remaining = Math.max(0, totalBalance - spent);

  let nextStatus: "ACTIVE" | "SUSPENDED" | "FINISHED";
  if (beneficiary.status === "SUSPENDED") {
    nextStatus = "SUSPENDED";
  } else if (remaining <= 0) {
    nextStatus = "FINISHED";
  } else {
    nextStatus = "ACTIVE";
  }

  await tx.beneficiary.update({
    where: { id: beneficiaryId },
    data: {
      remaining_balance: remaining,
      status: nextStatus,
      completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "IMPORT") : null,
    },
  });
}
