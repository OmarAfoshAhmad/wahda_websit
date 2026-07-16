"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { canonicalizeCardNumber } from "@/lib/normalize";
import {
  classifyLegacyReplacement,
  normalizeLegacyIdentityName,
  type LegacyResolutionPerson,
} from "@/lib/legacy-card-resolution";
import { mergeDuplicateBeneficiaries } from "@/app/actions/beneficiary/merge";
import { logger } from "@/lib/logger";
import { revalidatePath, revalidateTag } from "next/cache";

type BeneficiaryAnalysisRow = {
  id: string;
  name: string;
  card_number: string;
  birth_date: Date | null;
  created_at: Date;
  city: string | null;
  batch_number: string | null;
  total_balance: number;
  remaining_balance: number;
  transaction_count: number;
  active_transaction_count: number;
  manual_transaction_count: number;
  spent_amount: number;
  notification_count: number;
  registry_confirmed: boolean;
};

export type LegacyCardAnalysisItem = {
  legacyId: string;
  name: string;
  legacyCard: string;
  birthDate: string | null;
  city: string | null;
  batchNumber: string | null;
  totalBalance: number;
  remainingBalance: number;
  transactionCount: number;
  activeTransactionCount: number;
  spentAmount: number;
  replacement: {
    id: string;
    cardNumber: string;
    batchNumber: string | null;
    createdAt: string;
  } | null;
  candidateCards: string[];
  reason: string;
};

export type LegacyCardResolutionAnalysis = {
  confirmedCurrent: LegacyCardAnalysisItem[];
  safeWithReplacement: LegacyCardAnalysisItem[];
  withoutReplacement: LegacyCardAnalysisItem[];
  needsReview: LegacyCardAnalysisItem[];
  truncated: boolean;
};

function asResolutionPerson(
  row: Pick<BeneficiaryAnalysisRow, "id" | "name" | "card_number" | "birth_date" | "created_at" | "batch_number">
    & { registry_confirmed?: boolean },
): LegacyResolutionPerson {
  return {
    id: row.id,
    name: row.name,
    cardNumber: row.card_number,
    birthDate: row.birth_date?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    batchNumber: row.batch_number,
    registryConfirmed: row.registry_confirmed,
  };
}

async function loadModernCandidates(legacyRows: Array<Pick<BeneficiaryAnalysisRow, "name" | "card_number">>) {
  const normalizedNames = [...new Set(legacyRows.map((row) => normalizeLegacyIdentityName(row.name)).filter(Boolean))];
  if (normalizedNames.length === 0) return [];
  const wanted = new Set(normalizedNames);
  const wantedCanonicalCards = new Set(legacyRows.map((row) => canonicalizeCardNumber(row.card_number)));
  const rows = await prisma.beneficiary.findMany({
    where: { deleted_at: null, is_legacy_card: false },
    select: {
      id: true, name: true, card_number: true, birth_date: true, created_at: true,
      city: true, batch_number: true, total_balance: true, remaining_balance: true,
    },
    orderBy: [{ created_at: "desc" }, { card_number: "asc" }],
  });
  const matching = rows.filter((row) =>
    wanted.has(normalizeLegacyIdentityName(row.name)) || wantedCanonicalCards.has(canonicalizeCardNumber(row.card_number))
  );
  if (matching.length === 0) return [];
  const registryCards = new Set((await prisma.cardIssuanceRegistry.findMany({
    where: { card_number_upper: { in: matching.map((row) => row.card_number.toUpperCase()) } },
    select: { card_number_upper: true },
  })).map((row) => row.card_number_upper));
  return matching.map((row): BeneficiaryAnalysisRow => ({
    ...row,
    total_balance: Number(row.total_balance),
    remaining_balance: Number(row.remaining_balance),
    transaction_count: 0,
    active_transaction_count: 0,
    manual_transaction_count: 0,
    spent_amount: 0,
    notification_count: 0,
    registry_confirmed: registryCards.has(row.card_number.toUpperCase()),
  }));
}

async function loadLegacyAnalysisRows(searchQuery = "") {
  const q = searchQuery.trim();
  return prisma.$queryRaw<BeneficiaryAnalysisRow[]>`
    SELECT
      b.id,
      b.name,
      b.card_number,
      b.birth_date,
      b.created_at,
      b.city,
      b.batch_number,
      b.total_balance::float8 AS total_balance,
      b.remaining_balance::float8 AS remaining_balance,
      COUNT(t.id)::int AS transaction_count,
      COUNT(t.id) FILTER (WHERE t.is_cancelled = false AND t.type <> 'CANCELLATION')::int AS active_transaction_count,
      COUNT(t.id) FILTER (WHERE t.is_cancelled = false AND t.type NOT IN ('IMPORT', 'CANCELLATION'))::int AS manual_transaction_count,
      COALESCE(SUM(t.amount) FILTER (WHERE t.is_cancelled = false AND t.type <> 'CANCELLATION'), 0)::float8 AS spent_amount,
      (SELECT COUNT(*)::int FROM "Notification" n WHERE n.beneficiary_id = b.id) AS notification_count
      , false AS registry_confirmed
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
    WHERE b.deleted_at IS NULL
      AND b.is_legacy_card = true
      AND (${q} = '' OR b.name ILIKE ${`%${q}%`} OR b.card_number ILIKE ${`%${q}%`})
    GROUP BY b.id
    ORDER BY b.name ASC, b.card_number ASC
    LIMIT 1001
  `;
}

function toAnalysisItem(
  legacy: BeneficiaryAnalysisRow,
  decision: ReturnType<typeof classifyLegacyReplacement>,
): LegacyCardAnalysisItem {
  return {
    legacyId: legacy.id,
    name: legacy.name,
    legacyCard: legacy.card_number,
    birthDate: legacy.birth_date?.toISOString() ?? null,
    city: legacy.city,
    batchNumber: legacy.batch_number,
    totalBalance: Number(legacy.total_balance),
    remainingBalance: Number(legacy.remaining_balance),
    transactionCount: Number(legacy.transaction_count),
    activeTransactionCount: Number(legacy.active_transaction_count),
    spentAmount: Number(legacy.spent_amount),
    replacement: decision.replacement
      ? {
          id: decision.replacement.id,
          cardNumber: decision.replacement.cardNumber,
          batchNumber: decision.replacement.batchNumber ?? null,
          createdAt: decision.replacement.createdAt,
        }
      : null,
    candidateCards: decision.candidates.map((candidate) => candidate.cardNumber),
    reason: decision.reason,
  };
}

export async function getLegacyCardResolutionAnalysis(searchQuery = ""): Promise<LegacyCardResolutionAnalysis> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { confirmedCurrent: [], safeWithReplacement: [], withoutReplacement: [], needsReview: [], truncated: false };
  }

  const loadedLegacyRows = await loadLegacyAnalysisRows(searchQuery);
  const truncated = loadedLegacyRows.length > 1000;
  const legacyRows = loadedLegacyRows.slice(0, 1000);
  const modernRows = await loadModernCandidates(legacyRows);
  const modernByName = new Map<string, BeneficiaryAnalysisRow[]>();
  const modernByCanonicalCard = new Map<string, BeneficiaryAnalysisRow[]>();

  for (const row of modernRows) {
    const key = normalizeLegacyIdentityName(row.name);
    modernByName.set(key, [...(modernByName.get(key) ?? []), row]);
    const cardKey = canonicalizeCardNumber(row.card_number);
    modernByCanonicalCard.set(cardKey, [...(modernByCanonicalCard.get(cardKey) ?? []), row]);
  }

  const result: LegacyCardResolutionAnalysis = {
    confirmedCurrent: [],
    safeWithReplacement: [],
    withoutReplacement: [],
    needsReview: [],
    truncated,
  };

  for (const legacy of legacyRows) {
    const candidates = [...new Map([
      ...(modernByName.get(normalizeLegacyIdentityName(legacy.name)) ?? []),
      ...(modernByCanonicalCard.get(canonicalizeCardNumber(legacy.card_number)) ?? []),
    ].map((candidate) => [candidate.id, candidate])).values()];
    const decision = classifyLegacyReplacement(asResolutionPerson(legacy), candidates.map(asResolutionPerson));
    const item = toAnalysisItem(legacy, decision);
    if (Number(legacy.manual_transaction_count) > 0) {
      result.confirmedCurrent.push({
        ...item,
        replacement: null,
        candidateCards: [],
        reason: `لها ${Number(legacy.manual_transaction_count).toLocaleString("ar-LY")} حركة يدوية؛ حركة IMPORT غير محتسبة كدليل`,
      });
    } else if (decision.kind === "SAFE") result.safeWithReplacement.push(item);
    else if (decision.kind === "REVIEW") result.needsReview.push(item);
    else result.withoutReplacement.push(item);
  }

  return result;
}

export async function resolveLegacyCardWithReplacementAction(legacyId: string, replacementId: string) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) return { error: "غير مصرح بهذه العملية" };

  try {
    const legacy = await prisma.beneficiary.findFirst({
      where: { id: legacyId, deleted_at: null, is_legacy_card: true },
      select: {
        id: true, name: true, card_number: true, birth_date: true, created_at: true,
        batch_number: true, _count: { select: { transactions: true, notifications: true } },
      },
    });
    if (!legacy) return { error: "البطاقة القديمة غير موجودة أو تمت معالجتها" };

    const modernRows = await loadModernCandidates([legacy]);
    const decision = classifyLegacyReplacement(
      asResolutionPerson(legacy),
      modernRows.map(asResolutionPerson),
    );

    if (decision.kind !== "SAFE" || decision.replacement?.id !== replacementId) {
      return { error: "تغيّرت بيانات المطابقة أو لم تعد مؤكدة؛ حدّث الصفحة وراجع الحالة" };
    }

    if (legacy._count.transactions > 0 || legacy._count.notifications > 0) {
      const merged = await mergeDuplicateBeneficiaries(replacementId, {
        forceKeep: true,
        explicitMergeIds: [legacyId],
        candidateIds: [replacementId, legacyId],
        strategy: "ZERO_PRIORITY",
      });
      if (merged.error) return merged;

      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "RESOLVE_LEGACY_CARD_WITH_REPLACEMENT",
          metadata: {
            legacy_beneficiary_id: legacyId,
            replacement_beneficiary_id: replacementId,
            resolution: "merged",
            merge_audit_id: merged.mergeAuditId ?? null,
            matching_reason: decision.reason,
          },
        },
      });
      return { success: true, mode: "merged", auditId: merged.mergeAuditId };
    }

    const deletedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const changed = await tx.beneficiary.updateMany({
        where: { id: legacyId, deleted_at: null, is_legacy_card: true },
        data: { deleted_at: deletedAt },
      });
      if (changed.count !== 1) throw new Error("STALE_LEGACY_CARD");
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "RESOLVE_LEGACY_CARD_WITH_REPLACEMENT",
          metadata: {
            legacy_beneficiary_id: legacyId,
            replacement_beneficiary_id: replacementId,
            legacy_card_number: legacy.card_number,
            resolution: "soft_deleted_unused_original",
            deleted_at: deletedAt.toISOString(),
            matching_reason: decision.reason,
          },
        },
      });
    });

    revalidatePath("/admin/duplicates");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, mode: "deleted" };
  } catch (error) {
    logger.error("Resolve legacy card with replacement failed", { legacyId, replacementId, error: String(error) });
    return { error: "تعذرت معالجة البطاقة القديمة بأمان" };
  }
}

export async function deleteUnusedLegacyCardAction(legacyId: string) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) return { error: "غير مصرح بهذه العملية" };

  try {
    const legacy = await prisma.beneficiary.findFirst({
      where: { id: legacyId, deleted_at: null, is_legacy_card: true },
      select: { id: true, name: true, card_number: true, birth_date: true, created_at: true, batch_number: true },
    });
    if (!legacy) return { error: "البطاقة القديمة غير موجودة أو تمت معالجتها" };

    const manualUsage = await prisma.transaction.count({
      where: { beneficiary_id: legacyId, is_cancelled: false, type: { notIn: ["IMPORT", "CANCELLATION"] } },
    });
    if (manualUsage > 0) return { error: "هذه البطاقة لها حركات يدوية وتُعامل كبطاقة مستخدمة حديثًا؛ لا يمكن حذفها" };

    const modernRows = await loadModernCandidates([legacy]);
    const decision = classifyLegacyReplacement(
      asResolutionPerson(legacy),
      modernRows.map(asResolutionPerson),
    );
    if (decision.kind !== "NONE") {
      return { error: "يوجد بديل محتمل لهذه البطاقة؛ راجع قسم البطاقات الحديثة قبل الحذف" };
    }

    const deletedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Beneficiary"
        WHERE id = ${legacyId} AND deleted_at IS NULL AND is_legacy_card = true
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("STALE_LEGACY_CARD");

      const activeUsage = await tx.transaction.aggregate({
        where: { beneficiary_id: legacyId, is_cancelled: false, type: { not: "CANCELLATION" } },
        _count: { id: true },
        _sum: { amount: true },
      });
      const changed = await tx.beneficiary.updateMany({
        where: { id: legacyId, deleted_at: null, is_legacy_card: true },
        data: { deleted_at: deletedAt },
      });
      if (changed.count !== 1) throw new Error("STALE_LEGACY_CARD");
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "DELETE_UNUSED_LEGACY_CARD",
          metadata: {
            beneficiary_id: legacy.id,
            beneficiary_name: legacy.name,
            card_number: legacy.card_number,
            verified_active_transaction_count: activeUsage._count.id,
            verified_spent_amount: Number(activeUsage._sum.amount ?? 0),
            deleted_at: deletedAt.toISOString(),
          },
        },
      });
    });

    revalidatePath("/admin/duplicates");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true };
  } catch (error) {
    logger.error("Delete unused legacy card failed", { legacyId, error: String(error) });
    return { error: "تعذر حذف البطاقة القديمة بأمان" };
  }
}

export async function bulkResolveLegacyCardsAction(mode: "merge_confirmed" | "delete_without_replacement") {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) return { error: "غير مصرح بهذه العملية", processed: 0, failed: 0 };

  const analysis = await getLegacyCardResolutionAnalysis();
  if (analysis.truncated) {
    return { error: "عدد البطاقات يتجاوز 1000؛ استخدم البحث أو نفّذ على دفعات", processed: 0, failed: 0 };
  }

  if (mode === "merge_confirmed") {
    let processed = 0;
    let failed = 0;
    const failures: Array<{ legacyId: string; cardNumber: string; reason: string }> = [];
    if (analysis.confirmedCurrent.length > 0) {
      const currentIds = analysis.confirmedCurrent.map((item) => item.legacyId);
      const retained = await prisma.$transaction(async (tx) => {
        const updated = await tx.beneficiary.updateMany({
          where: { id: { in: currentIds }, deleted_at: null, is_legacy_card: true },
          data: { is_legacy_card: false },
        });
        await tx.auditLog.create({
          data: {
            facility_id: session.id,
            user: session.username,
            action: "BULK_RETAIN_MANUALLY_USED_CARDS",
            metadata: {
              processed_count: updated.count,
              rule: "active_non_import_non_cancellation_transaction",
              beneficiary_ids: currentIds,
            },
          },
        });
        return updated.count;
      });
      processed += retained;
      if (retained !== currentIds.length) failed += currentIds.length - retained;
    }
    for (const item of analysis.safeWithReplacement) {
      if (!item.replacement) continue;
      const result = await resolveLegacyCardWithReplacementAction(item.legacyId, item.replacement.id);
      if ("error" in result && result.error) {
        failed++;
        failures.push({ legacyId: item.legacyId, cardNumber: item.legacyCard, reason: result.error });
      } else {
        processed++;
      }
    }
    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "BULK_RESOLVE_LEGACY_WITH_REPLACEMENT",
        metadata: {
          attempted_count: analysis.safeWithReplacement.length + analysis.confirmedCurrent.length,
          processed_count: processed,
          failed_count: failed,
          failures,
        },
      },
    });
    revalidatePath("/admin/duplicates");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: `تم اعتماد ودمج ${processed.toLocaleString("ar-LY")} بطاقة حديثة${failed ? `، وتعذر ${failed.toLocaleString("ar-LY")}` : ""}`, processed, failed };
  }

  const candidates = analysis.withoutReplacement;
  if (candidates.length === 0) return { success: "لا توجد بطاقات بلا بديل تحتاج حذفًا", processed: 0, failed: 0 };
  const ids = candidates.map((item) => item.legacyId);
  const deletedAt = new Date();
  try {
    const processed = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Beneficiary"
        WHERE id = ANY(${ids}::text[]) AND deleted_at IS NULL AND is_legacy_card = true
        FOR UPDATE
      `;
      const lockedIds = locked.map((row) => row.id);
      if (lockedIds.length !== ids.length) throw new Error("STALE_LEGACY_BATCH");
      const updated = await tx.beneficiary.updateMany({
        where: { id: { in: lockedIds }, deleted_at: null, is_legacy_card: true },
        data: { deleted_at: deletedAt },
      });
      if (updated.count !== lockedIds.length) throw new Error("STALE_LEGACY_BATCH");
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_DELETE_LEGACY_WITHOUT_REPLACEMENT",
          metadata: {
            deleted_at: deletedAt.toISOString(),
            processed_count: updated.count,
            details: candidates.map((item) => ({
              beneficiary_id: item.legacyId,
              beneficiary_name: item.name,
              card_number: item.legacyCard,
              remaining_balance: item.remainingBalance,
              active_transaction_count: item.activeTransactionCount,
              spent_amount: item.spentAmount,
              result: "soft_deleted_transactions_preserved",
            })),
          },
        },
      });
      return updated.count;
    }, { isolationLevel: "Serializable", timeout: 120_000 });
    revalidatePath("/admin/duplicates");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: `تم حذف ${processed.toLocaleString("ar-LY")} بطاقة قديمة بلا بديل حذفًا ناعمًا مع حفظ الحركات`, processed, failed: 0 };
  } catch (error) {
    logger.error("Bulk delete legacy cards without replacement failed", { error: String(error), count: ids.length });
    return { error: "تغيرت بعض البيانات أثناء التنفيذ؛ لم تُحذف أي بطاقة", processed: 0, failed: ids.length };
  }
}
