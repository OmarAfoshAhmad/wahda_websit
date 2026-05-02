import "server-only";

import prisma from "@/lib/prisma";
import { canonicalizeCardNumber, normalizeCardNumber } from "@/lib/normalize";

export type BeneficiaryIssuanceMeta = {
  city: string | null;
  batchNumber: string | null;
  sourceFile: string | null;
};

type RegistryRow = {
  card_number_upper: string;
  canonical_card: string;
  city: string;
  batch_number: string | null;
  source_file: string | null;
};

export async function getBeneficiariesIssuanceMeta(
  _projectRoot: string,
  cardNumbers: string[],
): Promise<{ byCard: Map<string, BeneficiaryIssuanceMeta>; missingFolders: string[] }> {
  const byCard = new Map<string, BeneficiaryIssuanceMeta>();

  const normalizedCards = cardNumbers
    .map((v) => normalizeCardNumber(v))
    .filter((v) => Boolean(v));

  if (normalizedCards.length === 0) {
    return { byCard, missingFolders: [] };
  }

  const canonicalCards = Array.from(new Set(normalizedCards.map((v) => canonicalizeCardNumber(v))));

  const rows = await prisma.$queryRaw<RegistryRow[]>`
    SELECT
      "card_number_upper",
      "canonical_card",
      "city",
      "batch_number",
      "source_file"
    FROM "CardIssuanceRegistry"
    WHERE "card_number_upper" = ANY(${normalizedCards}::text[])
       OR "canonical_card" = ANY(${canonicalCards}::text[])
  `;

  const byExact = new Map<string, RegistryRow>();
  const canonicalBuckets = new Map<string, RegistryRow[]>();

  for (const row of rows) {
    if (!byExact.has(row.card_number_upper)) {
      byExact.set(row.card_number_upper, row);
    }

    const bucket = canonicalBuckets.get(row.canonical_card) ?? [];
    bucket.push(row);
    canonicalBuckets.set(row.canonical_card, bucket);
  }

  const byUniqueCanonical = new Map<string, RegistryRow>();
  for (const [canonical, bucket] of canonicalBuckets.entries()) {
    const unique = Array.from(new Map(bucket.map((r) => [r.card_number_upper, r])).values());
    if (unique.length === 1) {
      byUniqueCanonical.set(canonical, unique[0]);
    }
  }

  for (const rawCard of cardNumbers) {
    const normalizedCard = normalizeCardNumber(rawCard);
    if (!normalizedCard) {
      byCard.set(rawCard, { city: null, batchNumber: null, sourceFile: null });
      continue;
    }

    const exact = byExact.get(normalizedCard);
    const canonical = byUniqueCanonical.get(canonicalizeCardNumber(normalizedCard));
    const meta = exact ?? canonical ?? null;

    byCard.set(rawCard, {
      city: meta?.city ?? null,
      batchNumber: meta?.batch_number ?? null,
      sourceFile: meta?.source_file ?? null,
    });
  }

  return { byCard, missingFolders: [] };
}
