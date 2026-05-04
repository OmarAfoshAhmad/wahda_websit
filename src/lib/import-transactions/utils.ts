import prisma from "@/lib/prisma";

export function familySuffixRegex(baseCard: string): string {
  // Match family-member suffixes with or without numeric index (M/F/H or M1/F1/H2...).
  return `^${baseCard}[WSDMFHV][0-9]*$`;
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildFamilyBaseRegex(baseCards: string[]): string {
  const parts = baseCards.map((card) => escapeRegexLiteral(String(card ?? "").trim())).filter(Boolean);
  if (parts.length === 0) return "^$";
  return `^(${parts.join("|")})([WSDMFHV][0-9]*)?$`;
}

/**
 * Build a map: rawNumber (no leading zeros) → full card number from DB.
 * Only base cards (WAB2025 + digits, no suffix) are indexed.
 */
export async function buildCardLookup(): Promise<Map<string, string>> {
  const allBeneficiaries = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: { card_number: true },
  });

  const lookup = new Map<string, string>();
  for (const b of allBeneficiaries) {
    if (/^WAB2025\d+$/.test(b.card_number)) {
      const rawNum = String(parseInt(b.card_number.slice(7), 10));
      lookup.set(rawNum, b.card_number);
    }
  }
  return lookup;
}

/**
 * Resolve the raw card number from Excel to a full WAB2025 base card.
 */
export function resolveCardNumber(rawCard: string, lookup: Map<string, string>): string | null {
  const cleaned = rawCard.trim();
  if (!cleaned) return null;

  // Already a full card?
  if (cleaned.startsWith("WAB2025")) {
    const numPart = cleaned.slice(7);
    if (/^\d+$/.test(numPart)) {
      const rawNum = String(parseInt(numPart, 10));
      return lookup.get(rawNum) ?? null;
    }
    return null;
  }

  // Raw number
  const rawNum = String(parseInt(cleaned, 10));
  if (isNaN(parseInt(cleaned, 10))) return null;
  return lookup.get(rawNum) ?? null;
}

export function normalizeUsedBalanceForImport(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  // Business rule: grouped import used balance must be integer-only.
  return Math.round(numeric);
}
