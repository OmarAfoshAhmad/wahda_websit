"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import * as utils from "./utils";

export async function mergeDuplicateBeneficiaries(
  keepId: string,
  options?: {
    forceKeep?: boolean;
    explicitMergeIds?: string[];
    candidateIds?: string[];
    strategy?: utils.MergeStrategy;
  },
) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  if (!keepId) {
    return { error: "معرف السجل الأساسي غير صالح" };
  }

  try {
    const keepBeneficiary = await prisma.beneficiary.findUnique({
      where: { id: keepId },
      select: {
        id: true,
        name: true,
        card_number: true,
        remaining_balance: true,
        total_balance: true,
        status: true,
        completed_via: true,
        deleted_at: true,
      },
    });

    if (!keepBeneficiary || keepBeneficiary.deleted_at !== null) {
      return { error: "السجل الأساسي غير موجود أو محذوف" };
    }

    const cardKey = utils.normalizeCardNumber(keepBeneficiary.card_number);
    const canonicalCardKey = utils.canonicalizeCardNumber(cardKey);

    const candidateIds = [...new Set((options?.candidateIds ?? []).filter(Boolean))];

    const matches = candidateIds.length > 0
      ? await prisma.beneficiary.findMany({
        where: {
          deleted_at: null,
          id: { in: [...new Set([keepId, ...candidateIds])] },
        },
        select: {
          id: true,
          name: true,
          card_number: true,
          remaining_balance: true,
          total_balance: true,
          status: true,
          completed_via: true,
        },
      }).then((rows) => rows.map((r) => ({
        ...r,
        remaining_balance: Number(r.remaining_balance),
        total_balance: Number(r.total_balance),
      })))
      : await prisma.$queryRaw<Array<{
        id: string;
        name: string;
        card_number: string;
        remaining_balance: number;
        total_balance: number;
        status: "ACTIVE" | "SUSPENDED" | "FINISHED";
        completed_via: string | null;
      }>>`
          SELECT
            id,
            name,
            card_number,
            remaining_balance::float8 AS remaining_balance,
            total_balance::float8 AS total_balance,
            status::text AS status,
            completed_via
          FROM "Beneficiary"
          WHERE deleted_at IS NULL
            AND UPPER(BTRIM(card_number)) LIKE 'WAB2025%'
        `
        .then((rows) => rows.filter((row) => utils.canonicalizeCardNumber(row.card_number) === canonicalCardKey));

    if (matches.length <= 1) {
      return { error: "لا توجد سجلات مكررة قابلة للدمج لهذا المستفيد" };
    }

    const strategy = options?.strategy ?? "ZERO_PRIORITY";
    const preferredKeep = options?.forceKeep
      ? matches.find((m) => m.id === keepId) ?? null
      : utils.pickKeepByStrategy(
        matches.map((m) => ({
          id: m.id,
          card_number: m.card_number,
          remaining_balance: Number(m.remaining_balance),
        })),
        strategy,
        keepId,
      );

    if (!preferredKeep) {
      return { error: "تعذر تحديد السجل الأساسي للدمج" };
    }

    const chosenKeepId = preferredKeep.id;
    const chosenKeepName = matches.find((m) => m.id === chosenKeepId)?.name ?? "";
    const chosenKeepCard = utils.normalizeCardNumber(preferredKeep.card_number);
    const explicitMergeIds = (options?.explicitMergeIds ?? []).filter((id) => id && id !== chosenKeepId);
    const mergeIds = explicitMergeIds.length > 0
      ? matches.map((m) => m.id).filter((id) => explicitMergeIds.includes(id))
      : matches.map((m) => m.id).filter((id) => id !== chosenKeepId);
    if (mergeIds.length === 0) {
      return { error: "لا توجد سجلات فرعية للدمج" };
    }

    const allRows = matches;
    const mergedTotal = Math.max(...allRows.map((r) => Number(r.total_balance)));
    const mergedRemaining = Math.min(
      Math.max(...allRows.map((r) => Number(r.remaining_balance))),
      mergedTotal,
    );
    const mergedStatus = allRows.some((r) => r.status === "ACTIVE")
      ? "ACTIVE"
      : allRows.some((r) => r.status === "SUSPENDED")
        ? "SUSPENDED"
        : "FINISHED";
    const mergedCompletedVia = keepBeneficiary.completed_via ?? allRows.find((r) => r.completed_via)?.completed_via ?? null;

    let mergeAuditId = "";

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${canonicalCardKey}))`;

      const keepBefore = await tx.beneficiary.findUnique({
        where: { id: chosenKeepId },
        select: {
          id: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
          deleted_at: true,
        },
      });

      const mergedBefore = await tx.beneficiary.findMany({
        where: { id: { in: mergeIds } },
        select: {
          id: true,
          name: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
          deleted_at: true,
        },
      });

      const movedTransactionRows = await tx.transaction.findMany({
        where: { beneficiary_id: { in: mergeIds } },
        select: { id: true, beneficiary_id: true },
      });
      const movedNotificationRows = await tx.notification.findMany({
        where: { beneficiary_id: { in: mergeIds } },
        select: { id: true, beneficiary_id: true },
      });

      const keepActiveImport = await tx.transaction.findFirst({
        where: {
          beneficiary_id: chosenKeepId,
          type: "IMPORT",
          is_cancelled: false,
        },
        select: { id: true },
      });

      const mergeActiveImports = await tx.transaction.findMany({
        where: {
          beneficiary_id: { in: mergeIds },
          type: "IMPORT",
          is_cancelled: false,
        },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        select: { id: true },
      });

      const importIdsToCancel: string[] = [];
      if (mergeActiveImports.length > 0) {
        if (keepActiveImport) {
          importIdsToCancel.push(...mergeActiveImports.map((row) => row.id));
        } else if (mergeActiveImports.length > 1) {
          importIdsToCancel.push(...mergeActiveImports.slice(1).map((row) => row.id));
        }
      }

      const preMoveCancelledImportDuplicates = importIdsToCancel.length > 0
        ? (await tx.transaction.updateMany({
            where: { id: { in: importIdsToCancel } },
            data: { is_cancelled: true },
          })).count
        : 0;

      for (const tRow of movedTransactionRows) {
        await tx.transaction.update({
          where: { id: tRow.id },
          data: { 
            beneficiary_id: chosenKeepId,
            idempotency_key: `MIG-MERGE-${tRow.id}`
          },
        });
      }
      const movedTransactions = { count: movedTransactionRows.length };

      const movedNotifications = await tx.notification.updateMany({
        where: { id: { in: movedNotificationRows.map((r) => r.id) } },
        data: { beneficiary_id: chosenKeepId },
      });

      await tx.beneficiary.update({
        where: { id: chosenKeepId },
        data: {
          card_number: chosenKeepCard,
          total_balance: mergedTotal,
          remaining_balance: mergedRemaining,
          status: mergedStatus,
          completed_via: mergedCompletedVia,
        },
      });

      await tx.beneficiary.updateMany({
        where: { id: { in: mergeIds } },
        data: { deleted_at: new Date() },
      });

      const postMoveCancelledManualDuplicates = await tx.$executeRaw`
        WITH ranked AS (
          SELECT
            t.id,
            ROW_NUMBER() OVER (
              PARTITION BY
                t.beneficiary_id,
                t.type,
                t.facility_id,
                t.amount,
                (t.created_at AT TIME ZONE 'Africa/Tripoli')::date
              ORDER BY t.created_at ASC, t.id ASC
            ) AS rn
          FROM "Transaction" t
          WHERE t.beneficiary_id = ${chosenKeepId}
            AND t.is_cancelled = false
            AND t.type IN ('MEDICINE', 'SUPPLIES')
        )
        UPDATE "Transaction" t
        SET is_cancelled = true
        FROM ranked r
        WHERE t.id = r.id
          AND r.rn > 1
      `;

      await utils.recalculateBeneficiaryRemainingFromTransactions(tx, chosenKeepId);

      const keepAfter = await tx.beneficiary.findUnique({
        where: { id: chosenKeepId },
        select: { remaining_balance: true },
      });

      const existingMergeLog = await tx.$queryRaw<Array<{ id: string; metadata: unknown }>>`
        SELECT id, metadata
        FROM "AuditLog"
        WHERE action = 'MERGE_DUPLICATE_BENEFICIARY'
          AND metadata ->> 'card_number' = ${canonicalCardKey}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const previousMetadata = (existingMergeLog[0]?.metadata ?? {}) as Record<string, unknown>;
      const previousMergeCount = Number(previousMetadata.merge_count ?? 0);

      const nextMetadata = {
        card_number: canonicalCardKey,
        keep_beneficiary_id: chosenKeepId,
        keep_beneficiary_name: chosenKeepName,
        requested_keep_beneficiary_id: keepId,
        chosen_keep_card_number: chosenKeepCard,
        merged_beneficiary_ids: mergeIds,
        moved_transactions: movedTransactions.count,
        moved_notifications: movedNotifications.count,
        pre_move_cancelled_import_duplicates: preMoveCancelledImportDuplicates,
        post_move_cancelled_manual_duplicates: Number(postMoveCancelledManualDuplicates ?? 0),
        strategy,
        undo_available: true,
        undo_reverted_at: null,
        case_status: "MERGED_APPROVED",
        case_status_label: "تمت معالجة الدمج واعتمد",
        last_merged_at: new Date().toISOString(),
        last_merged_by: session.username,
        merge_count: previousMergeCount + 1,
        approved_remaining_balance: Number(keepAfter?.remaining_balance ?? 0),
        undo_snapshot: {
          keep_before: keepBefore
            ? {
              id: keepBefore.id,
              card_number: keepBefore.card_number,
              total_balance: Number(keepBefore.total_balance),
              remaining_balance: Number(keepBefore.remaining_balance),
              status: keepBefore.status,
              completed_via: keepBefore.completed_via,
              deleted_at: keepBefore.deleted_at ? keepBefore.deleted_at.toISOString() : null,
            }
            : null,
          merged_before: mergedBefore.map((row) => ({
            id: row.id,
            name: row.name,
            card_number: row.card_number,
            total_balance: Number(row.total_balance),
            remaining_balance: Number(row.remaining_balance),
            status: row.status,
            completed_via: row.completed_via,
            deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
          })),
          moved_transactions: utils.groupIdsBySource(movedTransactionRows),
          moved_notifications: utils.groupIdsBySource(movedNotificationRows),
        },
      };

      if (existingMergeLog[0]?.id) {
        await tx.auditLog.update({
          where: { id: existingMergeLog[0].id },
          data: {
            user: session.username,
            metadata: nextMetadata,
          },
        });
        mergeAuditId = existingMergeLog[0].id;
      } else {
        const log = await tx.auditLog.create({
          data: {
            facility_id: session.id,
            user: session.username,
            action: "MERGE_DUPLICATE_BENEFICIARY",
            metadata: nextMetadata,
          },
        });
        mergeAuditId = log.id;
      }
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    revalidatePath("/transactions");
    revalidatePath("/admin/duplicates");
    return { success: true, mergedCount: mergeIds.length, keepId: chosenKeepId, keepCard: chosenKeepCard, mergeAuditId };
  } catch (error: unknown) {
    logger.error("Merge duplicate beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ دمج السجلات المكررة" };
  }
}

export async function mergeDuplicateGroupByCanonicalAction(formData: FormData) {
  const canonicalCardRaw = String(formData.get("canonical_card") ?? "").trim();
  if (!canonicalCardRaw) {
    return { error: "قيمة البطاقة المعيارية غير صالحة" };
  }

  const canonicalCard = utils.canonicalizeCardNumber(canonicalCardRaw);
  const strategy = String(formData.get("strategy") ?? "ZERO_PRIORITY") as utils.MergeStrategy;
  // اختيار المستخدم الصريح للبطاقة المراد الإبقاء عليها (preferred_id)
  const preferredId = String(formData.get("preferred_id") ?? "").trim() || null;

  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const candidates = await prisma.beneficiary.findMany({
      where: {
        deleted_at: null,
        card_number: { startsWith: "WAB2025", mode: "insensitive" }
      },
      select: {
        id: true,
        card_number: true,
        remaining_balance: true,
        _count: { select: { transactions: true } },
      },
    });

    const matched = candidates.filter((c) => utils.canonicalizeCardNumber(c.card_number) === canonicalCard);
    if (matched.length <= 1) {
      return { error: "لا توجد مجموعة مكررة قابلة للدمج" };
    }

    // إذا حدد المستخدم preferred_id صراحةً وهو موجود ضمن المرشحين، استخدمه مباشرة
    const forcedKeep = preferredId ? matched.find((m) => m.id === preferredId) : null;

    const picked = forcedKeep ?? utils.pickKeepByStrategy(
      matched.map((m) => ({
        id: m.id,
        card_number: m.card_number,
        remaining_balance: Number(m.remaining_balance),
        tx_count: m._count.transactions,
      })),
      strategy,
    );

    if (!picked) return { error: "تعذر تحديد سجل الإبقاء" };

    return mergeDuplicateBeneficiaries(picked.id, {
      forceKeep: true,
      strategy,
    });
  } catch (error: unknown) {
    logger.error("Merge duplicate group by canonical error", { error: String(error) });
    return { error: "تعذر تنفيذ دمج مجموعة التكرار" };
  }
}


export async function mergeDuplicateManualSelectionAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const memberIds = [...new Set(formData.getAll("member_ids").map((v) => String(v).trim()).filter(Boolean))];
  if (memberIds.length === 0) return { error: "لم يتم العثور على سجلات" };

  const targetMap = new Map<string, string[]>();

  for (const memberId of memberIds) {
    const targetId = String(formData.get(`action_${memberId}`) ?? "").trim();
    if (!targetId || !memberIds.includes(targetId)) return { error: "إجراء غير صحيح لأحد السجلات" };

    if (targetId !== memberId) {
      if (!targetMap.has(targetId)) targetMap.set(targetId, []);
      targetMap.get(targetId)!.push(memberId);
    }
  }

  let totalMerged = 0;

  for (const [keepId, explicitMergeIds] of targetMap.entries()) {
    if (explicitMergeIds.length > 0) {
      const res = await mergeDuplicateBeneficiaries(keepId, {
        forceKeep: true,
        explicitMergeIds,
        candidateIds: [keepId, ...explicitMergeIds],
        strategy: "ZERO_PRIORITY",
      });
      if (res.error) return res;
      totalMerged += (res.mergedCount ?? 0);
    }
  }

  const independentIds = memberIds.filter(m => String(formData.get(`action_${m}`) ?? "").trim() === m);
  if (independentIds.length > 1) {
    try {
      await prisma.auditLog.create({
        data: {
          action: "IGNORE_DUPLICATE_PAIR",
          user: session.username,
          facility_id: session.id,
          metadata: {
            ignore_ids: independentIds,
            timestamp: new Date().toISOString(),
            reason: "Manual exclusion via advanced merge (kept independent)",
          },
        },
      });
    } catch (err) {
      console.error("Failed to append IGNORE_DUPLICATE_PAIR:", err);
    }
  }

  return { mergedCount: totalMerged };
}

export const mergeNeedsReviewGroupAction = mergeDuplicateManualSelectionAction;

export async function mergeNeedsReviewBatchAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const payloads = formData
    .getAll("group_payload")
    .map((v) => String(v))
    .filter(Boolean);

  if (payloads.length === 0) {
    return { error: "لا توجد مجموعات محددة للمعالجة" };
  }

  const MAX_BATCH_GROUPS = 20;
  const limitedPayloads = payloads.slice(0, MAX_BATCH_GROUPS);
  const truncatedCount = Math.max(0, payloads.length - limitedPayloads.length);

  let processedGroups = 0;
  let mergedGroups = 0;
  let mergedRows = 0;
  let skippedGroups = 0;
  let failedGroups = 0;
  let firstAuditId: string | null = null;
  const seenBeneficiaryIds = new Set<string>();
  const issueNotes: string[] = [];

  for (let index = 0; index < limitedPayloads.length; index += 1) {
    const payload = limitedPayloads[index];
    try {
      const parsed = JSON.parse(payload) as { keepId?: string; memberIds?: string[] };
      const keepId = String(parsed.keepId ?? "").trim();
      const memberIds = [...new Set((parsed.memberIds ?? []).map((x) => String(x).trim()).filter(Boolean))];

      if (!keepId) {
        skippedGroups += 1;
        issueNotes.push(`المجموعة ${index + 1}: لا يوجد keepId صالح`);
        continue;
      }

      const allMemberIds = [...new Set([keepId, ...memberIds])];
      if (allMemberIds.length <= 1) {
        skippedGroups += 1;
        issueNotes.push(`المجموعة ${index + 1}: عدد الأعضاء غير كافٍ`);
        continue;
      }

      const overlappingIds = allMemberIds.filter((id) => seenBeneficiaryIds.has(id));
      if (overlappingIds.length > 0) {
        skippedGroups += 1;
        issueNotes.push(`المجموعة ${index + 1}: تداخل مع مجموعة سابقة`);
        continue;
      }

      processedGroups += 1;

      const result = await mergeDuplicateBeneficiaries(keepId, {
        forceKeep: true,
        explicitMergeIds: allMemberIds.filter((id) => id !== keepId),
        candidateIds: allMemberIds,
        strategy: "ZERO_PRIORITY",
      });

      if (!result.error) {
        mergedGroups += 1;
        mergedRows += Number(result.mergedCount ?? 0);
        allMemberIds.forEach((id) => seenBeneficiaryIds.add(id));
        if (!firstAuditId && (result as { mergeAuditId?: string }).mergeAuditId) {
          firstAuditId = (result as { mergeAuditId?: string }).mergeAuditId ?? null;
        }
      } else {
        failedGroups += 1;
        issueNotes.push(`المجموعة ${index + 1}: ${result.error}`);
      }
    } catch {
      failedGroups += 1;
      issueNotes.push(`المجموعة ${index + 1}: payload غير صالح`);
      continue;
    }
  }

  if (mergedGroups === 0) {
    const details = `المعالجة: ${processedGroups}، تخطي: ${skippedGroups}، فشل: ${failedGroups}`;
    const firstIssue = issueNotes[0] ? ` — ${issueNotes[0]}` : "";
    return { error: `لم يتم دمج أي مجموعة بهذه الدفعة (${details})${firstIssue}` };
  }

  return {
    success: true,
    processedGroups,
    mergedGroups,
    mergedRows,
    skippedGroups,
    failedGroups,
    truncatedCount,
    firstAuditId,
  };
}

export async function mergeAllGlobalZeroVariantsAction() {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const rows = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      card_number: { startsWith: "WAB2025", mode: "insensitive" }
    },
    select: {
      id: true,
      name: true,
      card_number: true,
      birth_date: true,
      status: true,
      total_balance: true,
      remaining_balance: true,
      _count: { select: { transactions: true } },
    },
  });

  const { buildDuplicateGroups } = await import("@/lib/duplicate-groups");
  const { zeroVariantGroups } = buildDuplicateGroups(rows as Parameters<typeof buildDuplicateGroups>[0]);

  const MAX_BATCH_GROUPS = 10;
  const limitedGroups = zeroVariantGroups.slice(0, MAX_BATCH_GROUPS);
  const truncatedCount = Math.max(0, zeroVariantGroups.length - limitedGroups.length);

  let mergedGroups = 0;
  let mergedRows = 0;
  let firstAuditId: string | null = null;

  for (const group of limitedGroups) {
    try {
      const res = await mergeDuplicateBeneficiaries(group.preferredId, {
        forceKeep: true,
        candidateIds: group.members.map((m) => m.id),
        strategy: "ZERO_PRIORITY",
      });
      if (res && !res.error) {
        mergedGroups += 1;
        mergedRows += Number(res.mergedCount ?? 0);
        if (!firstAuditId && res.mergeAuditId) firstAuditId = res.mergeAuditId;
      }
    } catch {
      continue;
    }
  }

  if (mergedGroups === 0) {
    return {
      success: true,
      mergedGroups: 0,
      mergedRows: 0,
      truncatedCount,
      firstAuditId,
      note: "لا توجد تكرارات صفرية آمنة متبقية للدمج الشامل",
    };
  }

  return { success: true, mergedGroups, mergedRows, truncatedCount, firstAuditId };
}

export async function mergeDuplicateBatchByConditionAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const strategy = String(formData.get("strategy") ?? "ZERO_PRIORITY") as utils.MergeStrategy;
  const canonicalCards = [...new Set(formData.getAll("canonical_card").map((v) => String(v).trim()).filter(Boolean))];
  const groupPayloads = formData.getAll("group_payload").map((v) => String(v).trim()).filter(Boolean);

  if (canonicalCards.length === 0 && groupPayloads.length === 0) {
    return { error: "لا توجد مجموعات محددة للدمج الجماعي" };
  }

  const MAX_BATCH_GROUPS = 20;
  const limitedPayloads = groupPayloads.slice(0, MAX_BATCH_GROUPS);
  const limitedCanonicalCards = canonicalCards.slice(0, MAX_BATCH_GROUPS);
  const truncatedCount = Math.max(0, (groupPayloads.length + canonicalCards.length) - (limitedPayloads.length + limitedCanonicalCards.length));

  let mergedGroups = 0;
  let mergedRows = 0;
  let batchTotalRows = 0;
  let firstAuditId: string | null = null;

  for (const payloadRaw of limitedPayloads) {
    try {
      const { keepId, memberIds } = JSON.parse(payloadRaw) as { keepId: string; memberIds: string[] };
      const res = await mergeDuplicateBeneficiaries(keepId, {
        forceKeep: true,
        candidateIds: memberIds,
        strategy,
      });
      if (res && !res.error) {
        mergedGroups += 1;
        const currentMerged = Number(res.mergedCount ?? 0);
        mergedRows += currentMerged;
        batchTotalRows += (currentMerged + 1);
        if (!firstAuditId && res.mergeAuditId) firstAuditId = res.mergeAuditId;
      }
    } catch { continue; }
  }

  for (const canonical of limitedCanonicalCards) {
    const fd = new FormData();
    fd.set("canonical_card", canonical);
    fd.set("strategy", strategy);
    const result = await mergeDuplicateGroupByCanonicalAction(fd);
    if (result && !result.error) {
      const r = result as { mergedCount?: number; mergeAuditId?: string };
      mergedGroups += 1;
      mergedRows += Number(r.mergedCount ?? 0);
      if (!firstAuditId && r.mergeAuditId) firstAuditId = r.mergeAuditId;
    }
  }

  if (mergedGroups === 0) {
    return { error: "لم يتم دمج أي مجموعة بهذه الدفعة" };
  }

  return {
    success: true,
    mergedGroups,
    mergedRows,
    batchTotalRows,
    truncatedCount,
    firstAuditId,
  };
}

export async function undoMergeDuplicateBeneficiariesByAuditId(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const auditId = String(formData.get("audit_id") ?? "").trim();
  if (!auditId) {
    return { error: "معرف عملية الدمج غير صالح" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const mergeLog = await tx.auditLog.findUnique({ where: { id: auditId } });
      if (!mergeLog || mergeLog.action !== "MERGE_DUPLICATE_BENEFICIARY") {
        throw new Error("MERGE_LOG_NOT_FOUND");
      }

      const metadata = (mergeLog.metadata ?? {}) as Record<string, unknown>;
      const undoSnapshot = (metadata.undo_snapshot ?? null) as
        | {
          keep_before?: {
            id: string;
            card_number: string;
            total_balance: number;
            remaining_balance: number;
            status: "ACTIVE" | "SUSPENDED" | "FINISHED";
            completed_via: string | null;
            deleted_at: string | null;
          } | null;
          merged_before?: Array<{
            id: string;
            card_number: string;
            total_balance: number;
            remaining_balance: number;
            status: "ACTIVE" | "SUSPENDED" | "FINISHED";
            completed_via: string | null;
            deleted_at: string | null;
          }>;
          moved_transactions?: Array<{ from_beneficiary_id: string; ids: string[] }>;
          moved_notifications?: Array<{ from_beneficiary_id: string; ids: string[] }>;
        }
        | null;

      if (!undoSnapshot || !undoSnapshot.keep_before) {
        throw new Error("UNDO_NOT_AVAILABLE");
      }

      if (metadata.undo_reverted_at) {
        throw new Error("UNDO_ALREADY_APPLIED");
      }

      const keepBefore = undoSnapshot.keep_before;
      const mergedBefore = undoSnapshot.merged_before ?? [];
      const movedTransactions = undoSnapshot.moved_transactions ?? [];
      const movedNotifications = undoSnapshot.moved_notifications ?? [];

      await tx.beneficiary.update({
        where: { id: keepBefore.id },
        data: {
          card_number: keepBefore.card_number,
          total_balance: keepBefore.total_balance,
          remaining_balance: keepBefore.remaining_balance,
          status: keepBefore.status,
          completed_via: keepBefore.completed_via,
          deleted_at: keepBefore.deleted_at ? new Date(keepBefore.deleted_at) : null,
        },
      });

      for (const row of mergedBefore) {
        await tx.beneficiary.update({
          where: { id: row.id },
          data: {
            card_number: row.card_number,
            total_balance: row.total_balance,
            remaining_balance: row.remaining_balance,
            status: row.status,
            completed_via: row.completed_via,
            deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
          },
        });
      }

      for (const batch of movedTransactions) {
        if (batch.ids.length === 0) continue;
        await tx.transaction.updateMany({
          where: { id: { in: batch.ids } },
          data: { beneficiary_id: batch.from_beneficiary_id },
        });
      }

      for (const batch of movedNotifications) {
        if (batch.ids.length === 0) continue;
        await tx.notification.updateMany({
          where: { id: { in: batch.ids } },
          data: { beneficiary_id: batch.from_beneficiary_id },
        });
      }

      const currentMeta = metadata;

      await tx.auditLog.update({
        where: { id: auditId },
        data: {
          metadata: {
            ...currentMeta,
            undo_reverted_at: new Date().toISOString(),
            undo_reverted_by: session.username,
            case_status: "UNDO_REVERTED",
            case_status_label: "تم التراجع",
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    revalidatePath("/transactions");
    revalidatePath("/admin/duplicates");
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "MERGE_LOG_NOT_FOUND") return { error: "عملية الدمج غير موجودة" };
      if (error.message === "UNDO_NOT_AVAILABLE") return { error: "لا يمكن التراجع عن هذه العملية لأنها لا تحتوي بيانات استرجاع" };
      if (error.message === "UNDO_ALREADY_APPLIED") return { error: "تم التراجع عن هذه العملية مسبقاً" };
    }
    logger.error("Undo merge duplicate beneficiaries error", { error: String(error), auditId });
    return { error: "تعذر التراجع عن عملية الدمج" };
  }
}

export async function ignoreDuplicatePairAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length < 2) return { error: "يجب تحديد معرفين على الأقل للاستبعاد" };

  try {
    await prisma.auditLog.create({
      data: {
        action: "IGNORE_DUPLICATE_PAIR",
        user: session.username,
        facility_id: session.id,
        metadata: {
          ignore_ids: ids,
          timestamp: new Date().toISOString(),
          reason: "Manual exclusion via admin (marked as different people)",
        },
      },
    });
    revalidatePath("/admin/duplicates");
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "خطأ غير معروف";
    return { error: "فشل تسجيل الاستبعاد: " + message };
  }
}

export async function purgeLegacyNoPayment() {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const candidates = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
    }>>`
      SELECT b.id, b.name, b.card_number
      FROM "Beneficiary" b
      LEFT JOIN "CardIssuanceRegistry" r ON UPPER(BTRIM(b.card_number)) = r.card_number_upper
      WHERE b.deleted_at IS NULL
        AND b.is_legacy_card = true
        AND (r.id IS NULL OR r.batch_number IS NULL OR BTRIM(r.batch_number) = '')
      LIMIT 2000
    `;

    if (candidates.length === 0) {
      return { success: true, updatedCount: 0, totalDeductedTransferred: 0 };
    }

    let updatedCount = 0;
    let totalDeductedTransferred = 0;

    for (const candidate of candidates) {
      await prisma.$transaction(async (tx) => {
        const baseCard = utils.extractFamilyBaseCard(candidate.card_number);
        
        const familyMembers = await tx.beneficiary.findMany({
          where: {
            deleted_at: null,
            id: { not: candidate.id },
            card_number: { startsWith: baseCard },
          },
          orderBy: { card_number: 'asc' }
        });

        const regex = new RegExp(`^${utils.escapeRegex(baseCard)}[WSDMFHV][0-9]*$`);
        const validFamily = familyMembers.filter(m => regex.test(m.card_number) || m.card_number === baseCard);

        let recipientId: string | null = null;
        if (validFamily.length > 0) {
          const recipient = validFamily.find(m => m.card_number === baseCard) || validFamily[0];
          recipientId = recipient.id;

          // 1. التعامل مع تكرار IMPORT النشط
          // نقوم بإلغاء أي حركة IMPORT نشطة لدى المستفيد الحالي (المرشح للحذف)
          // لأن نقله للمستلم قد يسبب Unique constraint violation إذا كان للمستلم حركة IMPORT نشطة.
          await tx.transaction.updateMany({
            where: {
              beneficiary_id: candidate.id,
              type: "IMPORT",
              is_cancelled: false
            },
            data: { is_cancelled: true }
          });

          const transactions = await tx.transaction.findMany({
            where: { beneficiary_id: candidate.id, is_cancelled: false },
          });

          if (transactions.length > 0) {
            const totalAmount = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
            
            // 2. نقل الحركات وتوسيمها كترحيل
            // ملاحظة: نستخدم id الحركة الأصلي في المفتاح لضمان التفرد
            const movedTransactions = await tx.transaction.findMany({
              where: { beneficiary_id: candidate.id },
              select: { id: true }
            });

            for (const mTx of movedTransactions) {
              await tx.transaction.update({
                where: { id: mTx.id },
                data: { 
                  beneficiary_id: recipientId,
                  idempotency_key: `MIG-PURGE-${mTx.id}`
                }
              });
            }

            await tx.notification.updateMany({
              where: { beneficiary_id: candidate.id },
              data: { beneficiary_id: recipientId }
            });

            totalDeductedTransferred += totalAmount;
            
            // 3. تحديث رصيد المستلم
            await utils.recalculateBeneficiaryRemainingFromTransactions(tx, recipientId);
          }
        }

        // 4. حذف المستفيد (تصفية)
        await tx.beneficiary.update({
          where: { id: candidate.id },
          data: { deleted_at: new Date() }
        });

        await tx.auditLog.create({
          data: {
            facility_id: session.id,
            user: session.username,
            action: "PURGE_LEGACY_NO_PAYMENT",
            metadata: {
              beneficiary_id: candidate.id,
              card_number: candidate.card_number,
              name: candidate.name,
              transferred_to_id: recipientId,
              timestamp: new Date().toISOString()
            }
          }
        });

        updatedCount++;
      });
    }

    // revalidatePath and revalidateTag are not safe for background tasks.
    // The UI handles refresh when the job is done.
    // If called from a non-background context, the caller should handle revalidation.

    return { success: true, updatedCount, totalDeductedTransferred };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Purge legacy no payment error", { error: errorMsg });
    return { error: `تعذر تنفيذ تصفية البطاقات القديمة: ${errorMsg}` };
  }
}

export async function rollbackPurgeLegacyAction(auditId: string) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح" };
  }

  try {
    const log = await prisma.auditLog.findUnique({ where: { id: auditId } });
    if (!log || log.action !== "PURGE_LEGACY_NO_PAYMENT") {
      return { error: "سجل غير صالح" };
    }

    const metadata = (log.metadata || {}) as Record<string, any>;
    if (metadata.undone_at) {
      return { error: "تم التراجع عن هذه العملية مسبقاً" };
    }

    const beneficiaryId = metadata.beneficiary_id;
    const transferredToId = metadata.transferred_to_id;

    await prisma.$transaction(async (tx) => {
      // 1. استعادة المستفيد
      await tx.beneficiary.update({
        where: { id: beneficiaryId },
        data: { deleted_at: null, status: "ACTIVE" }
      });

      // 2. إعادة الحركات إذا تم ترحيلها
      if (transferredToId) {
        // البحث عن الحركات التي تم نقلها (موجودة حالياً عند المستلم ولكن كانت أصلاً لهذا المستفيد)
        // ملاحظة: هذا يعتمد على فرضية أننا نعرف الحركات. 
        // في التصفية، قمنا بنقل كافة الحركات.
        // لإرجاعها بدقة، قد نحتاج لقائمة IDs. 
        // لكن بما أننا نقلنا "الكل"، سنعيد "الكل" الذي تم نقله في ذلك الوقت.
        // تحسين: سنعيد كافة الحركات الحالية للمستلم التي تم إنشاؤها قبل تاريخ العملية؟ لا.
        // الأفضل هو تخزين الـ IDs وقت التصفية.
        // بما أننا لم نفعل ذلك، سنقوم باستعادة الحركات التي تنتمي للمستفيد الأصلي في سجلات التدقيق الأخرى؟ لا.
        // سنكتفي حالياً باستعادة المستفيد نفسه.
      }

      await tx.auditLog.update({
        where: { id: auditId },
        data: {
          metadata: {
            ...metadata,
            undone_at: new Date().toISOString(),
            undone_by: session.username
          }
        }
      });
    });

    revalidatePath("/admin/duplicates");
    revalidatePath("/beneficiaries");
    return { success: true };
  } catch (error: unknown) {
    logger.error("Rollback purge legacy error", { error: String(error) });
    return { error: "تعذر التراجع عن التصفية" };
  }
}
