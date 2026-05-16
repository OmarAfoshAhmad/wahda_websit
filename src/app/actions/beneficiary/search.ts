"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLedgerRemainingByBeneficiaryId, getLedgerRemainingByBeneficiaryIds } from "@/lib/ledger-balance";
import { logger } from "@/lib/logger";
import { getArabicNormalization } from "@/lib/normalize";
import { roundCurrency } from "@/lib/money";
import * as utils from "./utils";

export async function searchBeneficiaries(query: string) {
  type SearchBeneficiaryItem = {
    id: string;
    name: string;
    card_number: string;
    remaining_balance: number;
    total_balance: number;
    status: string;
    has_manual_deduction: boolean;
    has_import_deduction: boolean;
    in_import_file: boolean;
    has_replacement_card: boolean;
    replacement_card_number: string | null;
    replacement_beneficiary_id: string | null;
  };

  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح", items: [] as SearchBeneficiaryItem[] };
  }

  const rateLimitError = await checkRateLimit(`search:${session.id}`, "search");
  if (rateLimitError) return { error: rateLimitError, items: [] as SearchBeneficiaryItem[] };

  const q = query.trim();
  if (q.length < 2 || q.length > 100) {
    return { items: [] as SearchBeneficiaryItem[] };
  }

  try {
    const normalizedQ = getArabicNormalization(q);
    const likePattern = `%${q}%`;
    const normalizedPattern = `%${normalizedQ}%`;

    const rows = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
      is_legacy_card: boolean;
      total_balance: number;
      remaining_balance: number;
      status: string;
      has_manual_deduction: boolean;
      has_import_deduction: boolean;
    }>>`
      SELECT
        id,
        name,
        card_number,
        "is_legacy_card",
        total_balance::float8,
        remaining_balance::float8,
        status,
        EXISTS (
          SELECT 1
          FROM "Transaction" t
          WHERE t.beneficiary_id = "Beneficiary".id
            AND t.is_cancelled = false
            AND t.type <> 'CANCELLATION'
            AND t.type <> 'IMPORT'
        ) AS has_manual_deduction,
        EXISTS (
          SELECT 1
          FROM "Transaction" t
          WHERE t.beneficiary_id = "Beneficiary".id
            AND t.is_cancelled = false
            AND t.type = 'IMPORT'
        ) AS has_import_deduction
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND (
          name ILIKE ${likePattern}
          OR name ILIKE ${normalizedPattern}
          OR card_number ILIKE ${likePattern}
        )
      ORDER BY GREATEST(
        word_similarity(${q}, name),
        word_similarity(${normalizedQ}, name),
        word_similarity(${q}, card_number)
      ) DESC
      LIMIT 20
    `;

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { items: [] as SearchBeneficiaryItem[] };

    const remainingById = await getLedgerRemainingByBeneficiaryIds(ids);

    const canonicalCards = Array.from(new Set(
      rows.map((row) => utils.canonicalizeCardNumber(row.card_number)).filter(Boolean),
    ));

    const replacementCandidates = canonicalCards.length > 0
      ? await prisma.$queryRaw<Array<{ id: string; card_number: string }>>`
          SELECT id, card_number
          FROM "Beneficiary"
          WHERE deleted_at IS NULL
            AND regexp_replace(UPPER(BTRIM(card_number)), '^WAB2025(0*)([0-9]+)([A-Z0-9]*)$', 'WAB2025\\2\\3') = ANY(${canonicalCards}::text[])
        `
      : [];

    const bestCandidateByCanonical = new Map<string, { id: string; card_number: string; zeroScore: number }>();
    for (const candidate of replacementCandidates) {
      const canonical = utils.canonicalizeCardNumber(candidate.card_number);
      const zeroScore = utils.leadingZeroScoreAfterPrefix(candidate.card_number);
      const prev = bestCandidateByCanonical.get(canonical);
      if (!prev) {
        bestCandidateByCanonical.set(canonical, { id: candidate.id, card_number: candidate.card_number, zeroScore });
        continue;
      }

      if (zeroScore > prev.zeroScore || (zeroScore === prev.zeroScore && candidate.card_number < prev.card_number)) {
        bestCandidateByCanonical.set(canonical, { id: candidate.id, card_number: candidate.card_number, zeroScore });
      }
    }

    const items: SearchBeneficiaryItem[] = rows.map((row) => {
      const canonical = utils.canonicalizeCardNumber(row.card_number);
      const zeroScore = utils.leadingZeroScoreAfterPrefix(row.card_number);
      const bestCandidate = bestCandidateByCanonical.get(canonical);
      const hasReplacement = Boolean(
        bestCandidate && bestCandidate.id !== row.id && bestCandidate.zeroScore > zeroScore,
      );

      return {
        ...row,
        remaining_balance: remainingById.get(row.id) ?? 0,
        total_balance: row.total_balance,
        in_import_file: Boolean(row.is_legacy_card),
        has_replacement_card: hasReplacement,
        replacement_card_number: hasReplacement && bestCandidate ? bestCandidate.card_number : null,
        replacement_beneficiary_id: hasReplacement && bestCandidate ? bestCandidate.id : null,
      };
    });

    return { items };
  } catch (error: unknown) {
    logger.error("Search beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ البحث", items: [] as SearchBeneficiaryItem[] };
  }
}

export async function getBeneficiaryFamilyImportInsights(beneficiaryId: string) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح" };
  }

  const rateLimitError = await checkRateLimit(`search:${session.id}`, "search");
  if (rateLimitError) return { error: rateLimitError };

  const cleanId = String(beneficiaryId ?? "").trim();
  if (!cleanId) {
    return { error: "معرف المستفيد غير صالح" };
  }

  try {
    // ensureFamilyImportArchiveTable: no-op — الجدول الآن في Prisma Schema

    const beneficiary = await prisma.beneficiary.findFirst({
      where: { id: cleanId, deleted_at: null },
      select: { id: true, card_number: true },
    });

    if (!beneficiary) {
      return { error: "المستفيد غير موجود" };
    }

    const familyBaseCard = beneficiary.card_number.replace(/([A-Z]\d+)$/, "");

    const members = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
      status: string;
      total_balance: number;
      remaining_balance: number;
      manual_deducted: number;
      import_deducted: number;
      consumed_total: number;
    }>>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        b.status::text,
        b.total_balance::float8,
        b.remaining_balance::float8,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type NOT IN ('CANCELLATION', 'IMPORT', 'DENTAL') THEN COALESCE(t.actual_company_share, t.amount) ELSE 0 END), 0)::float8 AS manual_deducted,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'IMPORT' THEN COALESCE(t.actual_company_share, t.amount) ELSE 0 END), 0)::float8 AS import_deducted,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type NOT IN ('CANCELLATION', 'DENTAL') THEN COALESCE(t.actual_company_share, t.amount) ELSE 0 END), 0)::float8 AS consumed_total
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
        AND b.card_number LIKE ${familyBaseCard + "%"}
      GROUP BY b.id, b.name, b.card_number, b.status, b.total_balance, b.remaining_balance
      ORDER BY b.card_number ASC
    `;

    const archiveRows = await prisma.$queryRaw<Array<{
      family_count_from_file: number;
      total_balance_from_file: number;
      used_balance_from_file: number;
    }>>`
      SELECT
        "family_count_from_file"::int AS family_count_from_file,
        "total_balance_from_file"::float8 AS total_balance_from_file,
        "used_balance_from_file"::float8 AS used_balance_from_file
      FROM "FamilyImportArchive"
      WHERE "family_base_card" = ${familyBaseCard}
      LIMIT 1
    `;

    const archive = archiveRows[0];
    const familyImportTotal = archive
      ? Number(archive.used_balance_from_file ?? 0)
      : members.reduce((sum, m) => sum + Number(m.import_deducted ?? 0), 0);
    const familyConsumedTotal = members.reduce((sum, m) => sum + Number(m.consumed_total ?? 0), 0);

    const expectedCountRows = await prisma.$queryRaw<Array<{ family_size: number }>>`
      SELECT (elem->>'familySize')::int AS family_size
      FROM "AuditLog" a,
      LATERAL jsonb_array_elements(COALESCE(a.metadata->'appliedRows', '[]'::jsonb)) AS elem
      WHERE a.action = 'IMPORT_TRANSACTIONS'
        AND (elem->>'familyBaseCard') = ${familyBaseCard}
      ORDER BY a.created_at DESC
      LIMIT 1
    `;

    const expectedFamilyCount = archive
      ? Number(archive.family_count_from_file ?? 0) || null
      : Number(expectedCountRows[0]?.family_size ?? 0) || null;
    const foundInSystemCount = members.length;

    return {
      item: {
        family_base_card: familyBaseCard,
        expected_family_count: expectedFamilyCount,
        family_total_balance_from_file: archive ? roundCurrency(Number(archive.total_balance_from_file ?? 0)) : null,
        found_in_system_count: foundInSystemCount,
        distributed_on_count: foundInSystemCount,
        family_import_total: roundCurrency(familyImportTotal),
        family_consumed_total: roundCurrency(familyConsumedTotal),
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          card_number: m.card_number,
          status: m.status,
          total_balance: Number(m.total_balance),
          remaining_balance: Number(m.remaining_balance),
          manual_deducted: roundCurrency(Number(m.manual_deducted)),
          import_deducted: roundCurrency(Number(m.import_deducted)),
          consumed_total: roundCurrency(Number(m.consumed_total)),
          import_share_percent: familyImportTotal > 0
            ? roundCurrency((Number(m.import_deducted) / familyImportTotal) * 100)
            : 0,
        })),
      },
    };
  } catch (error: unknown) {
    logger.error("Family import insights error", { error: String(error) });
    return { error: "تعذر جلب تفاصيل الاستيراد العائلي" };
  }
}
