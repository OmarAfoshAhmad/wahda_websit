"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { Prisma } from "@prisma/client";
import { extractBaseCard, normalizePersonName } from "@/lib/normalize";

const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_AUDIT_RETENTION_DAYS = 180;
const DEFAULT_JOBS_RETENTION_DAYS = 30;
const RESET_REQUIRED_FACILITY_HASH = "$2b$10$zIN5eU5a4P.45wgaiqCJzuw2vPDgNdYT1Lmr6eeHxndRxzS3rLsb6";

type SweepRequest = {
  dryRun?: boolean;
  mode?: DataHygieneMode;
  notificationRetentionDays?: number;
  auditRetentionDays?: number;
  jobsRetentionDays?: number;
};

type BackgroundActor = {
  id: string;
  username: string;
  isAdmin: true;
};

export type DataHygieneMode =
  | "all"
  | "unlinked_corrections"
  | "duplicate_movements"
  | "invalid_password_facilities"
  | "deleted_facilities"
  | "orphaned_notifications"
  | "old_read_notifications"
  | "old_login_audit_logs"
  | "old_import_jobs"
  | "old_restore_jobs";

export type DataHygieneSweepResult = {
  success: boolean;
  dryRun: boolean;
  mode: DataHygieneMode;
  unlinked_corrections: number;
  duplicate_movements: number;
  invalid_password_facilities: number;
  deleted_facilities: number;
  orphaned_notifications: number;
  old_read_notifications: number;
  old_login_audit_logs: number;
  old_import_jobs: number;
  old_restore_jobs: number;
  error?: string;
};

export type ParentCardPatternFixMode = "all_to_numbered" | "all_to_plain" | "h2_to_h1_only";

export type ParentCardPatternFixResult = {
  success: boolean;
  mode: ParentCardPatternFixMode;
  processed_count: number;
  merged_count: number;
  skipped_count: number;
  conflict_count: number;
  h2_fixed_count: number;
  parent_suffix_normalized_count: number;
  error?: string;
};

export type ImportIntegerDistributionFixResult = {
  success: boolean;
  processed_families: number;
  processed_members: number;
  updated_transactions: number;
  created_transactions: number;
  cancelled_transactions: number;
  error?: string;
};

export type InvalidSubunitAmountFixResult = {
  success: boolean;
  candidates_count: number;
  fixed_count: number;
  skipped_count: number;
  total_delta: number;
  error?: string;
};

function clampDays(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(3650, Math.max(1, Math.floor(value)));
}

export async function runDataHygieneSweepAction(
  request: SweepRequest = {},
  actor?: BackgroundActor,
): Promise<DataHygieneSweepResult> {
  const session = actor
    ? { id: actor.id, username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
  if (!session?.is_admin) {
    return {
      success: false,
      dryRun: Boolean(request.dryRun),
      mode: request.mode ?? "all",
      unlinked_corrections: 0,
      duplicate_movements: 0,
      invalid_password_facilities: 0,
      deleted_facilities: 0,
      orphaned_notifications: 0,
      old_read_notifications: 0,
      old_login_audit_logs: 0,
      old_import_jobs: 0,
      old_restore_jobs: 0,
      error: "غير مصرح",
    };
  }

  const dryRun = Boolean(request.dryRun);
  const mode: DataHygieneMode = request.mode ?? "all";
  const notificationRetentionDays = clampDays(
    request.notificationRetentionDays,
    DEFAULT_NOTIFICATION_RETENTION_DAYS
  );
  const auditRetentionDays = clampDays(
    request.auditRetentionDays,
    DEFAULT_AUDIT_RETENTION_DAYS
  );
  const jobsRetentionDays = clampDays(request.jobsRetentionDays, DEFAULT_JOBS_RETENTION_DAYS);

  const now = Date.now();
  const notificationCutoff = new Date(now - notificationRetentionDays * 24 * 60 * 60 * 1000);
  const auditCutoff = new Date(now - auditRetentionDays * 24 * 60 * 60 * 1000);
  const jobsCutoff = new Date(now - jobsRetentionDays * 24 * 60 * 60 * 1000);

  try {
    const [
      unlinkedCorrectionsCount,
      duplicateMovementsCount,
      invalidPasswordFacilitiesCount,
      deletedFacilitiesCount,
      orphanedCount,
      oldReadCount,
      oldLoginAuditCount,
      oldImportJobsCount,
      oldRestoreJobsCount,
    ] =
      await Promise.all([
        prisma.transaction.count({
          where: {
            type: "CANCELLATION",
            original_transaction_id: null,
            is_cancelled: false,
          },
        }),
        prisma.$queryRaw<Array<{ duplicate_movements_count: number }>>`
          WITH ranked AS (
            SELECT
              t.id,
              ROW_NUMBER() OVER (
                PARTITION BY t.beneficiary_id, t.type, t.amount, (t.created_at AT TIME ZONE 'Africa/Tripoli')::date
                ORDER BY t.created_at ASC, t.id ASC
              ) AS rn
            FROM "Transaction" t
            WHERE t.is_cancelled = false
              AND t.type <> 'CANCELLATION'
          )
          SELECT COUNT(*)::int AS duplicate_movements_count
          FROM ranked
          WHERE rn > 1
        `.then((rows) => Number(rows[0]?.duplicate_movements_count ?? 0)),
        prisma.$queryRaw<Array<{ invalid_password_facilities_count: number }>>`
          SELECT COUNT(*)::int AS invalid_password_facilities_count
          FROM "Facility" f
          WHERE f.deleted_at IS NULL
            AND (
              f.password_hash IS NULL
              OR BTRIM(f.password_hash) = ''
              OR f.password_hash !~ '^\\$2[aby]\\$.{56}$'
            )
        `.then((rows) => Number(rows[0]?.invalid_password_facilities_count ?? 0)),
        prisma.$queryRaw<Array<{ deleted_facilities_count: number }>>`
          SELECT COUNT(*)::int AS deleted_facilities_count
          FROM "Facility" f
          WHERE f.deleted_at IS NOT NULL
        `.then((rows) => Number(rows[0]?.deleted_facilities_count ?? 0)),
        prisma.notification.count({
          where: { beneficiary: { deleted_at: { not: null } } },
        }),
        prisma.notification.count({
          where: {
            is_read: true,
            created_at: { lt: notificationCutoff },
            beneficiary: { deleted_at: null },
          },
        }),
        prisma.auditLog.count({
          where: {
            created_at: { lt: auditCutoff },
            action: { in: ["LOGIN", "LOGOUT"] },
          },
        }),
        prisma.importJob.count({
          where: {
            created_at: { lt: jobsCutoff },
            status: { in: ["COMPLETED", "FAILED", "ROLLED_BACK"] },
          },
        }),
        prisma.restoreJob.count({
          where: {
            created_at: { lt: jobsCutoff },
            status: { in: ["COMPLETED", "FAILED"] },
          },
        }),
      ]);

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        mode,
        unlinked_corrections: unlinkedCorrectionsCount,
        duplicate_movements: duplicateMovementsCount,
        invalid_password_facilities: invalidPasswordFacilitiesCount,
        deleted_facilities: deletedFacilitiesCount,
        orphaned_notifications: orphanedCount,
        old_read_notifications: oldReadCount,
        old_login_audit_logs: oldLoginAuditCount,
        old_import_jobs: oldImportJobsCount,
        old_restore_jobs: oldRestoreJobsCount,
      };
    }

    await prisma.$transaction(async (tx) => {
      if (mode === "all" || mode === "orphaned_notifications") {
        await tx.notification.deleteMany({
          where: { beneficiary: { deleted_at: { not: null } } },
        });
      }

      if (mode === "unlinked_corrections") {
        await tx.transaction.updateMany({
          where: {
            type: "CANCELLATION",
            original_transaction_id: null,
            is_cancelled: false,
          },
          data: {
            is_cancelled: true,
          },
        });
      }

      if (mode === "duplicate_movements") {
        await tx.$executeRaw`
          WITH ranked AS (
            SELECT
              t.id,
              ROW_NUMBER() OVER (
                PARTITION BY t.beneficiary_id, t.type, t.amount, (t.created_at AT TIME ZONE 'Africa/Tripoli')::date
                ORDER BY t.created_at ASC, t.id ASC
              ) AS rn
            FROM "Transaction" t
            WHERE t.is_cancelled = false
              AND t.type <> 'CANCELLATION'
          )
          UPDATE "Transaction" t
          SET is_cancelled = true
          FROM ranked r
          WHERE t.id = r.id
            AND r.rn > 1
        `;
      }

      if (mode === "invalid_password_facilities") {
        await tx.$executeRaw`
          UPDATE "Facility" f
          SET
            password_hash = ${RESET_REQUIRED_FACILITY_HASH},
            must_change_password = true
          WHERE f.deleted_at IS NULL
            AND (
              f.password_hash IS NULL
              OR BTRIM(f.password_hash) = ''
              OR f.password_hash !~ '^\\$2[aby]\\$.{56}$'
            )
        `;
      }

      let deletedFacilitiesHardDeleted = 0;
      let deletedFacilitiesMovedTransactions = 0;
      if (mode === "all" || mode === "deleted_facilities") {
        const deletedFacilityRows = await tx.facility.findMany({
          where: { deleted_at: { not: null } },
          select: { id: true },
        });

        if (deletedFacilityRows.length > 0) {
          const deletedFacilityIds = deletedFacilityRows.map((row) => row.id);
          const archiveUsername = "__archive_deleted_facilities__";
          const archive = await tx.facility.upsert({
            where: { username: archiveUsername },
            update: {
              deleted_at: null,
              is_admin: false,
              is_manager: false,
              is_employee: false,
              must_change_password: true,
            },
            create: {
              name: "ارشيف المرافق المحذوفة",
              username: archiveUsername,
              password_hash: RESET_REQUIRED_FACILITY_HASH,
              is_admin: false,
              is_manager: false,
              is_employee: false,
              must_change_password: true,
            },
            select: { id: true },
          });

          deletedFacilitiesMovedTransactions = (await tx.transaction.updateMany({
            where: { facility_id: { in: deletedFacilityIds } },
            data: { facility_id: archive.id },
          })).count;

          deletedFacilitiesHardDeleted = (await tx.facility.deleteMany({
            where: { id: { in: deletedFacilityIds } },
          })).count;
        }
      }

      if (mode === "all" || mode === "old_read_notifications") {
        await tx.notification.deleteMany({
          where: {
            is_read: true,
            created_at: { lt: notificationCutoff },
            beneficiary: { deleted_at: null },
          },
        });
      }

      if (mode === "all" || mode === "old_login_audit_logs") {
        await tx.auditLog.deleteMany({
          where: {
            created_at: { lt: auditCutoff },
            action: { in: ["LOGIN", "LOGOUT"] },
          },
        });
      }

      if (mode === "all" || mode === "old_import_jobs") {
        await tx.importJob.deleteMany({
          where: {
            created_at: { lt: jobsCutoff },
            status: { in: ["COMPLETED", "FAILED", "ROLLED_BACK"] },
          },
        });
      }

      if (mode === "all" || mode === "old_restore_jobs") {
        await tx.restoreJob.deleteMany({
          where: {
            created_at: { lt: jobsCutoff },
            status: { in: ["COMPLETED", "FAILED"] },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          user: session.username,
          action: AUDIT_ACTIONS.DATA_HYGIENE_SWEEP,
          metadata: {
            dry_run: false,
            mode,
            notification_retention_days: notificationRetentionDays,
            audit_retention_days: auditRetentionDays,
            jobs_retention_days: jobsRetentionDays,
            unlinked_corrections_soft_cancelled: unlinkedCorrectionsCount,
            duplicate_movements_soft_cancelled: duplicateMovementsCount,
            invalid_password_facilities_reset_forced: invalidPasswordFacilitiesCount,
            deleted_facilities_hard_deleted: deletedFacilitiesHardDeleted,
            deleted_facilities_transactions_reassigned: deletedFacilitiesMovedTransactions,
            deleted_facilities_skipped_has_transactions: Math.max(0, deletedFacilitiesCount - deletedFacilitiesHardDeleted),
            orphaned_notifications_deleted: orphanedCount,
            old_read_notifications_deleted: oldReadCount,
            old_login_audit_logs_deleted: oldLoginAuditCount,
            old_import_jobs_deleted: oldImportJobsCount,
            old_restore_jobs_deleted: oldRestoreJobsCount,
          },
        },
      });
    });

    // عند التشغيل بالخلفية (actor موجود) لا نستدعي revalidatePath لتفادي خطأ Next.js.
    if (!actor) {
      revalidatePath("/admin/db-anomalies");
      revalidatePath("/admin/balance-health");
      revalidatePath("/admin/duplicates");
      revalidatePath("/transactions");
    }

    return {
      success: true,
      dryRun: false,
      mode,
      unlinked_corrections: unlinkedCorrectionsCount,
      duplicate_movements: duplicateMovementsCount,
      invalid_password_facilities: invalidPasswordFacilitiesCount,
      deleted_facilities: deletedFacilitiesCount,
      orphaned_notifications: orphanedCount,
      old_read_notifications: oldReadCount,
      old_login_audit_logs: oldLoginAuditCount,
      old_import_jobs: oldImportJobsCount,
      old_restore_jobs: oldRestoreJobsCount,
    };
  } catch (error) {
    console.error("[runDataHygieneSweepAction]", error);
    return {
      success: false,
      dryRun,
      mode,
      unlinked_corrections: 0,
      duplicate_movements: 0,
      invalid_password_facilities: 0,
      deleted_facilities: 0,
      orphaned_notifications: 0,
      old_read_notifications: 0,
      old_login_audit_logs: 0,
      old_import_jobs: 0,
      old_restore_jobs: 0,
      error: "تعذّر تنفيذ التنظيف",
    };
  }
}

function normalizeParentCardByMode(cardNumber: string, mode: ParentCardPatternFixMode) {
  const card = String(cardNumber ?? "").trim().toUpperCase();
  const match = card.match(/^(WAB2025\d+)([A-Z])(\d+)?$/);
  if (!match) {
    return { changed: false, nextCard: card, reason: "not_supported" as const };
  }

  const [, base, code, numRaw] = match;
  const num = numRaw ? Number(numRaw) : null;

  if (code === "H") {
    if (num === 2) {
      return { changed: true, nextCard: `${base}H1`, reason: "h2_to_h1" as const };
    }
    // H بدون رقم (مثل WAB2025123H) → يُحوَّل إلى H1 في وضع all_to_numbered
    if (num === null && mode === "all_to_numbered") {
      return { changed: true, nextCard: `${base}H1`, reason: "plain_to_numbered" as const };
    }
    return { changed: false, nextCard: card, reason: "h_valid" as const };
  }

  if (code !== "M" && code !== "F" && code !== "W") {
    return { changed: false, nextCard: card, reason: "not_parent_suffix" as const };
  }

  if (mode === "h2_to_h1_only") {
    return { changed: false, nextCard: card, reason: "mode_skip" as const };
  }

  if (mode === "all_to_numbered") {
    if (numRaw === undefined) {
      return { changed: true, nextCard: `${base}${code}1`, reason: "plain_to_numbered" as const };
    }
    return { changed: false, nextCard: card, reason: "already_numbered" as const };
  }

  // mode === "all_to_plain"
  if (num === 1) {
    return { changed: true, nextCard: `${base}${code}`, reason: "numbered_to_plain" as const };
  }

  return { changed: false, nextCard: card, reason: "plain_or_other_number" as const };
}

export async function runParentCardPatternFixAction(request: {
  mode?: ParentCardPatternFixMode;
  onProgress?: (progress: {
    total: number;
    examined: number;
    processed: number;
    skipped: number;
    conflicts: number;
    h2Fixed: number;
    normalized: number;
  }) => void;
} = {}, actor?: BackgroundActor): Promise<ParentCardPatternFixResult> {
  const session = actor
    ? { id: actor.id, username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
  if (!session?.is_admin) {
    return {
      success: false,
      mode: request.mode ?? "all_to_numbered",
      processed_count: 0,
      merged_count: 0,
      skipped_count: 0,
      conflict_count: 0,
      h2_fixed_count: 0,
      parent_suffix_normalized_count: 0,
      error: "غير مصرح",
    };
  }

  const mode = request.mode ?? "all_to_numbered";

  try {
    const candidates = await prisma.$queryRaw<Array<{ id: string; name: string; card_number: string }>>`
      SELECT b.id, b.name, b.card_number
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND (
          b.card_number ~ '^WAB2025[0-9]+W$'
          OR b.card_number ~ '^WAB2025[0-9]+W1$'
          OR b.card_number ~ '^WAB2025[0-9]+M$'
          OR b.card_number ~ '^WAB2025[0-9]+M1$'
          OR b.card_number ~ '^WAB2025[0-9]+F$'
          OR b.card_number ~ '^WAB2025[0-9]+F1$'
          OR b.card_number ~ '^WAB2025[0-9]+H$'
          OR b.card_number ~ '^WAB2025[0-9]+H2$'
        )
      ORDER BY b.card_number ASC
      LIMIT 10000
    `;

    const details: Array<Record<string, unknown>> = [];
    let processed = 0;
    let merged = 0;
    let skipped = 0;
    let conflicts = 0;
    let h2Fixed = 0;
    let parentNormalized = 0;
    let examined = 0;
    const undoSnapshot: Array<Record<string, unknown>> = [];

    request.onProgress?.({
      total: candidates.length,
      examined,
      processed,
      skipped,
      conflicts,
      h2Fixed,
      normalized: parentNormalized,
    });

    for (const row of candidates) {
      examined += 1;
      const normalized = normalizeParentCardByMode(row.card_number, mode);
      if (!normalized.changed || normalized.nextCard === row.card_number) {
        if (examined % 25 === 0 || examined === candidates.length) {
          request.onProgress?.({
            total: candidates.length,
            examined,
            processed,
            skipped,
            conflicts,
            h2Fixed,
            normalized: parentNormalized,
          });
        }
        continue;
      }

      const conflict = await prisma.beneficiary.findFirst({
        where: {
          deleted_at: null,
          card_number: normalized.nextCard,
          id: { not: row.id },
        },
        select: {
          id: true,
          name: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
        },
      });

      if (conflict) {
        const samePersonByNameAndBaseCard =
          normalizePersonName(conflict.name) === normalizePersonName(row.name) &&
          extractBaseCard(conflict.card_number) === extractBaseCard(row.card_number);

        if (samePersonByNameAndBaseCard) {
          const mergeResult = await prisma.$transaction(async (tx) => {
            const source = await tx.beneficiary.findUnique({
              where: { id: row.id },
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

            const target = await tx.beneficiary.findUnique({
              where: { id: conflict.id },
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

            if (!source || !target || source.deleted_at || target.deleted_at) {
              return { merged: false, movedTransactions: 0, movedNotifications: 0, reason: "missing_or_deleted" };
            }

            // دائمًا نحتفظ بالسجل الذي يحمل الرقم المستهدف (normalized.nextCard)
            // وننقل إليه حركات وإشعارات السجل الآخر.
            const keepId = target.id;
            const mergeId = source.id;
            const keepCardNumber = target.card_number;
            const keepCompletedVia = target.completed_via ?? source.completed_via;

            // يوجد قيد فريد فعلي في DB: IMPORT النشطة (is_cancelled=false) واحدة فقط لكل مستفيد.
            // لذلك نلغي أي IMPORT زائدة قبل نقل الحركات لتفادي فشل updateMany.
            const sourceActiveImports = await tx.transaction.findMany({
              where: {
                beneficiary_id: mergeId,
                type: "IMPORT",
                is_cancelled: false,
              },
              orderBy: { created_at: "asc" },
              select: { id: true },
            });

            const targetHasActiveImport = await tx.transaction.findFirst({
              where: {
                beneficiary_id: keepId,
                type: "IMPORT",
                is_cancelled: false,
              },
              select: { id: true },
            });

            const importIdsToCancel: string[] = [];

            // المصدر نفسه يجب ألا يحمل أكثر من IMPORT نشطة واحدة بعد التنظيف.
            if (sourceActiveImports.length > 1) {
              importIdsToCancel.push(...sourceActiveImports.slice(1).map((row) => row.id));
            }

            // إذا الهدف لديه IMPORT نشطة، نلغي أيضًا IMPORT النشطة المتبقية في المصدر قبل النقل.
            if (targetHasActiveImport && sourceActiveImports.length > 0) {
              const sourcePrimaryImportId = sourceActiveImports[0]?.id;
              if (sourcePrimaryImportId && !importIdsToCancel.includes(sourcePrimaryImportId)) {
                importIdsToCancel.push(sourcePrimaryImportId);
              }
            }

            const cancelledSourceImports = importIdsToCancel.length > 0
              ? (await tx.transaction.updateMany({
                  where: { id: { in: importIdsToCancel } },
                  data: { is_cancelled: true },
                })).count
              : 0;

            const movedTransactions = await tx.transaction.updateMany({
              where: { beneficiary_id: mergeId },
              data: { beneficiary_id: keepId },
            });

            const movedNotifications = await tx.notification.updateMany({
              where: { beneficiary_id: mergeId },
              data: { beneficiary_id: keepId },
            });

            const activeTransactions = await tx.transaction.aggregate({
              where: {
                beneficiary_id: keepId,
                is_cancelled: false,
                type: { not: "CANCELLATION" },
              },
              _sum: { amount: true },
            });

            const mergedTotal = Math.max(Number(source.total_balance) || 0, Number(target.total_balance) || 0);
            const spent = Number(activeTransactions._sum.amount ?? 0);
            const remaining = Math.max(0, mergedTotal - spent);
            const nextStatus =
              source.status === "SUSPENDED" || target.status === "SUSPENDED"
                ? "SUSPENDED"
                : (remaining <= 0 ? "FINISHED" : "ACTIVE");

            await tx.beneficiary.update({
              where: { id: keepId },
              data: {
                card_number: keepCardNumber,
                total_balance: mergedTotal,
                remaining_balance: remaining,
                status: nextStatus,
                completed_via: nextStatus === "FINISHED"
                  ? (keepCompletedVia ?? "IMPORT")
                  : null,
              },
            });

            await tx.beneficiary.update({
              where: { id: mergeId },
              data: { deleted_at: new Date() },
            });

            return {
              merged: true,
              keepBeneficiaryId: keepId,
              movedTransactions: movedTransactions.count,
              movedNotifications: movedNotifications.count,
              cancelledSourceImports,
              reason: "kept_numbered_target",
            };
          });

          if (mergeResult.merged) {
            processed += 1;
            merged += 1;
            details.push({
              beneficiary_id: row.id,
              beneficiary_name: row.name,
              old_card_number: row.card_number,
              new_card_number: conflict.card_number,
              result: "merged_to_numbered",
              reason: "name_and_base_card_match",
              merged_into_beneficiary_id: mergeResult.keepBeneficiaryId,
              moved_transactions: mergeResult.movedTransactions,
              moved_notifications: mergeResult.movedNotifications,
              cancelled_source_imports: mergeResult.cancelledSourceImports,
              merge_strategy: mergeResult.reason,
            });
            if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
              request.onProgress?.({
                total: candidates.length,
                examined,
                processed,
                skipped,
                conflicts,
                h2Fixed,
                normalized: parentNormalized,
              });
            }
            continue;
          }

          skipped += 1;
          conflicts += 1;
          details.push({
            beneficiary_id: row.id,
            beneficiary_name: row.name,
            old_card_number: row.card_number,
            new_card_number: normalized.nextCard,
            result: "skipped_conflict_merge_blocked",
            conflict_with: conflict.id,
            reason: mergeResult.reason,
          });
          if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
            request.onProgress?.({
              total: candidates.length,
              examined,
              processed,
              skipped,
              conflicts,
              h2Fixed,
              normalized: parentNormalized,
            });
          }
          continue;
        }

        skipped += 1;
        conflicts += 1;
        details.push({
          beneficiary_id: row.id,
          beneficiary_name: row.name,
          old_card_number: row.card_number,
          new_card_number: normalized.nextCard,
          result: "skipped_conflict",
          conflict_with: conflict.id,
          reason: normalized.reason,
        });
        if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
          request.onProgress?.({
            total: candidates.length,
            examined,
            processed,
            skipped,
            conflicts,
            h2Fixed,
            normalized: parentNormalized,
          });
        }
        continue;
      }

      try {
        await prisma.beneficiary.update({
          where: { id: row.id },
          data: { card_number: normalized.nextCard },
        });
      } catch (updateError) {
        // لا نفشل كامل المهمة بسبب تعارض فريد لسجل واحد؛ نُسجّل الحالة ونتابع.
        if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === "P2002") {
          skipped += 1;
          conflicts += 1;
          details.push({
            beneficiary_id: row.id,
            beneficiary_name: row.name,
            old_card_number: row.card_number,
            new_card_number: normalized.nextCard,
            result: "skipped_conflict_runtime",
            reason: "unique_constraint",
          });
          if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
            request.onProgress?.({
              total: candidates.length,
              examined,
              processed,
              skipped,
              conflicts,
              h2Fixed,
              normalized: parentNormalized,
            });
          }
          continue;
        }
        throw updateError;
      }

      processed += 1;
      undoSnapshot.push({
        id: row.id,
        old_card_number: row.card_number,
        new_card_number: normalized.nextCard,
      });
      if (normalized.reason === "h2_to_h1") {
        h2Fixed += 1;
      } else {
        parentNormalized += 1;
      }

      details.push({
        beneficiary_id: row.id,
        beneficiary_name: row.name,
        old_card_number: row.card_number,
        new_card_number: normalized.nextCard,
        result: "updated",
        reason: normalized.reason,
      });

      if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
        request.onProgress?.({
          total: candidates.length,
          examined,
          processed,
          skipped,
          conflicts,
          h2Fixed,
          normalized: parentNormalized,
        });
      }
    }

    request.onProgress?.({
      total: candidates.length,
      examined,
      processed,
      skipped,
      conflicts,
      h2Fixed,
      normalized: parentNormalized,
    });

    const detailsLimit = 500;
    const detailsForAudit = details.length > detailsLimit ? details.slice(0, detailsLimit) : details;

    await prisma.auditLog.create({
      data: {
        user: session.username,
        action: AUDIT_ACTIONS.FIX_PARENT_CARD_PATTERNS,
        metadata: {
          mode,
          processed_count: processed,
          merged_count: merged,
          skipped_count: skipped,
          conflict_count: conflicts,
          h2_fixed_count: h2Fixed,
          parent_suffix_normalized_count: parentNormalized,
          candidates_count: candidates.length,
          details_count: details.length,
          details_truncated: details.length > detailsLimit,
          details: detailsForAudit,
          undo_snapshot: undoSnapshot,
        },
      },
    });

    if (!actor) {
      revalidatePath("/admin/db-anomalies");
      revalidatePath("/admin/balance-health");
      revalidatePath("/admin/duplicates");
      revalidatePath("/admin/audit-log");
    }

    return {
      success: true,
      mode,
      processed_count: processed,
      merged_count: merged,
      skipped_count: skipped,
      conflict_count: conflicts,
      h2_fixed_count: h2Fixed,
      parent_suffix_normalized_count: parentNormalized,
    };
  } catch (error) {
    console.error("[runParentCardPatternFixAction]", error);
    const detailedError = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      mode,
      processed_count: 0,
      merged_count: 0,
      skipped_count: 0,
      conflict_count: 0,
      h2_fixed_count: 0,
      parent_suffix_normalized_count: 0,
      error: `تعذّر تنفيذ تحويل نمط البطاقات: ${detailedError}`,
    };
  }
}

export async function runNormalizeImportIntegerDistributionAction(
  actor?: BackgroundActor,
): Promise<ImportIntegerDistributionFixResult> {
  const session = actor
    ? { id: actor.id, username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
  if (!session?.is_admin) {
    return {
      success: false,
      processed_families: 0,
      processed_members: 0,
      updated_transactions: 0,
      created_transactions: 0,
      cancelled_transactions: 0,
      error: "غير مصرح",
    };
  }

  try {
    const familyCandidates = await prisma.$queryRaw<Array<{ family_base_card: string }>>`
      WITH family_imports AS (
        SELECT
          COALESCE(SUBSTRING(b.card_number FROM '^(WAB2025[0-9]+)'), b.card_number) AS family_base_card,
          t.id,
          t.beneficiary_id,
          t.amount
        FROM "Transaction" t
        JOIN "Beneficiary" b ON b.id = t.beneficiary_id
        WHERE t.type = 'IMPORT'
          AND t.is_cancelled = false
          AND b.deleted_at IS NULL
      )
      SELECT family_base_card
      FROM family_imports
      GROUP BY family_base_card
      HAVING
        BOOL_OR(ABS(amount - ROUND(amount)) > 0.000001)
        OR COUNT(id) > COUNT(DISTINCT beneficiary_id)
      ORDER BY family_base_card
      LIMIT 5000
    `;

    const details: Array<Record<string, unknown>> = [];
    const undoSnapshot: Array<Record<string, unknown>> = [];
    let processedFamilies = 0;
    let processedMembers = 0;
    let updatedTransactions = 0;
    let createdTransactions = 0;
    let cancelledTransactions = 0;

    for (const candidate of familyCandidates) {
      const familyBaseCard = String(candidate.family_base_card ?? "").trim();
      if (!familyBaseCard) continue;

      await prisma.$transaction(async (tx) => {
        const familyMembers = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string; completed_via: string | null }>>`
          SELECT id, name, card_number, remaining_balance, status::text, completed_via
          FROM "Beneficiary"
          WHERE deleted_at IS NULL
            AND card_number LIKE ${familyBaseCard + "%"}
          ORDER BY card_number ASC
          FOR UPDATE
        `;

        if (familyMembers.length === 0) return;

        const memberIds = familyMembers.map((m) => m.id);
        const importTxs = await tx.transaction.findMany({
          where: {
            beneficiary_id: { in: memberIds },
            type: "IMPORT",
            is_cancelled: false,
          },
          orderBy: { created_at: "asc" },
          select: {
            id: true,
            beneficiary_id: true,
            amount: true,
            is_cancelled: true,
          },
        });

        if (importTxs.length === 0) return;

        const totalUsed = Math.max(0, Math.round(importTxs.reduce((sum, txItem) => sum + Number(txItem.amount), 0)));
        const divisor = Math.max(1, familyMembers.length);
        const baseShare = Math.floor(totalUsed / divisor);
        const remainder = totalUsed - baseShare * divisor;

        const importsByMember = new Map<string, Array<{ id: string; amount: number }>>();
        for (const txItem of importTxs) {
          const arr = importsByMember.get(txItem.beneficiary_id) ?? [];
          arr.push({ id: txItem.id, amount: Number(txItem.amount) });
          importsByMember.set(txItem.beneficiary_id, arr);
        }

        const createdIdsForFamily: string[] = [];
        const memberSnapshots: Array<Record<string, unknown>> = [];

        for (let i = 0; i < familyMembers.length; i++) {
          const member = familyMembers[i];
          const existingForMember = importsByMember.get(member.id) ?? [];
          const previousImported = existingForMember.reduce((sum, item) => sum + Number(item.amount), 0);
          const balanceBeforeImport = Number(member.remaining_balance) + previousImported;
          const deductAmount = i === 0 ? baseShare + remainder : baseShare;
          const newBalance = Math.max(0, round2(balanceBeforeImport - deductAmount));
          const newStatus = member.status === "SUSPENDED"
            ? "SUSPENDED"
            : (newBalance <= 0 ? "FINISHED" : "ACTIVE");

          memberSnapshots.push({
            id: member.id,
            before_remaining_balance: Number(member.remaining_balance),
            before_status: member.status,
            before_completed_via: member.completed_via,
            tx_before: existingForMember,
          });

          await tx.beneficiary.update({
            where: { id: member.id },
            data: {
              remaining_balance: newBalance,
              status: newStatus as "ACTIVE" | "FINISHED" | "SUSPENDED",
              completed_via: newStatus === "FINISHED"
                ? "IMPORT"
                : (newStatus === "SUSPENDED" ? member.completed_via : null),
            },
          });

          if (existingForMember.length === 0) {
            if (deductAmount > 0) {
              const createdTx = await tx.transaction.create({
                data: {
                  beneficiary_id: member.id,
                  facility_id: session.id,
                  amount: deductAmount,
                  type: "IMPORT",
                },
                select: { id: true },
              });
              createdIdsForFamily.push(createdTx.id);
              createdTransactions += 1;
            }
          } else {
            await tx.transaction.update({
              where: { id: existingForMember[0].id },
              data: { amount: deductAmount },
            });
            updatedTransactions += 1;

            if (existingForMember.length > 1) {
              const extraIds = existingForMember.slice(1).map((item) => item.id);
              const cancelled = await tx.transaction.updateMany({
                where: { id: { in: extraIds }, is_cancelled: false },
                data: { is_cancelled: true },
              });
              cancelledTransactions += cancelled.count;
            }
          }

          details.push({
            family_base_card: familyBaseCard,
            beneficiary_id: member.id,
            beneficiary_name: member.name,
            card_number: member.card_number,
            before_import_total: round2(previousImported),
            after_import_total: deductAmount,
            before_remaining_balance: round2(Number(member.remaining_balance)),
            after_remaining_balance: round2(newBalance),
            result: "updated",
          });
          processedMembers += 1;
        }

        undoSnapshot.push({
          family_base_card: familyBaseCard,
          created_transaction_ids: createdIdsForFamily,
          members: memberSnapshots,
        });
        processedFamilies += 1;
      });
    }

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: AUDIT_ACTIONS.NORMALIZE_IMPORT_INTEGER_DISTRIBUTION,
        metadata: {
          processed_families: processedFamilies,
          processed_members: processedMembers,
          updated_transactions: updatedTransactions,
          created_transactions: createdTransactions,
          cancelled_transactions: cancelledTransactions,
          details,
          undo_snapshot: undoSnapshot,
        },
      },
    });

    if (!actor) {
      revalidatePath("/admin/db-anomalies");
      revalidatePath("/admin/balance-health");
      revalidatePath("/admin/duplicates");
      revalidatePath("/admin/audit-log");
    }

    return {
      success: true,
      processed_families: processedFamilies,
      processed_members: processedMembers,
      updated_transactions: updatedTransactions,
      created_transactions: createdTransactions,
      cancelled_transactions: cancelledTransactions,
    };
  } catch (error) {
    console.error("[runNormalizeImportIntegerDistributionAction]", error);
    return {
      success: false,
      processed_families: 0,
      processed_members: 0,
      updated_transactions: 0,
      created_transactions: 0,
      cancelled_transactions: 0,
      error: "تعذر تنفيذ معالجة التوزيع الصحيح للحصص",
    };
  }
}

function normalizeSubunitAmountToAllowed(amount: number): number {
  return amount < 0.5 ? 0.25 : 0.5;
}

export async function runFixInvalidSubunitAmountsAction(
  actor?: BackgroundActor,
): Promise<InvalidSubunitAmountFixResult> {
  const session = actor
    ? { id: actor.id, username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
  if (!session?.is_admin) {
    return {
      success: false,
      candidates_count: 0,
      fixed_count: 0,
      skipped_count: 0,
      total_delta: 0,
      error: "غير مصرح",
    };
  }

  try {
    const candidates = await prisma.transaction.findMany({
      where: {
        is_cancelled: false,
        type: { not: "CANCELLATION" },
        amount: { gt: 0, lt: 1 },
        NOT: [{ amount: 0.25 }, { amount: 0.5 }],
        beneficiary: { deleted_at: null },
      },
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        beneficiary_id: true,
        amount: true,
        type: true,
      },
      take: 5000,
    });

    const details: Array<Record<string, unknown>> = [];
    let fixedCount = 0;
    let skippedCount = 0;
    let totalDelta = 0;

    for (const candidate of candidates) {
      await prisma.$transaction(async (tx) => {
        const transactionRow = await tx.transaction.findUnique({
          where: { id: candidate.id },
          select: {
            id: true,
            beneficiary_id: true,
            amount: true,
            type: true,
            is_cancelled: true,
          },
        });

        if (!transactionRow || transactionRow.is_cancelled || transactionRow.type === "CANCELLATION") {
          skippedCount += 1;
          return;
        }

        const beneficiaryRows = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string; completed_via: string | null }>>`
          SELECT id, remaining_balance, status::text, completed_via
          FROM "Beneficiary"
          WHERE id = ${transactionRow.beneficiary_id}
            AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `;

        if (beneficiaryRows.length === 0) {
          skippedCount += 1;
          return;
        }

        const beneficiary = beneficiaryRows[0];
        const previousAmount = Number(transactionRow.amount);
        if (!(previousAmount > 0 && previousAmount < 1) || previousAmount === 0.25 || previousAmount === 0.5) {
          skippedCount += 1;
          return;
        }

        const nextAmount = normalizeSubunitAmountToAllowed(previousAmount);
        const delta = round2(nextAmount - previousAmount);
        const currentRemaining = Number(beneficiary.remaining_balance);
        const nextRemaining = round2(currentRemaining - delta);

        if (nextRemaining < 0) {
          skippedCount += 1;
          details.push({
            transaction_id: transactionRow.id,
            beneficiary_id: beneficiary.id,
            before_amount: previousAmount,
            after_amount: nextAmount,
            delta,
            skipped_reason: "remaining_would_be_negative",
          });
          return;
        }

        const nextStatus = beneficiary.status === "SUSPENDED"
          ? "SUSPENDED"
          : (nextRemaining <= 0 ? "FINISHED" : "ACTIVE");

        await tx.transaction.update({
          where: { id: transactionRow.id },
          data: { amount: nextAmount },
        });

        await tx.beneficiary.update({
          where: { id: beneficiary.id },
          data: {
            remaining_balance: nextRemaining,
            status: nextStatus as "ACTIVE" | "FINISHED" | "SUSPENDED",
            completed_via: nextStatus === "SUSPENDED"
              ? beneficiary.completed_via
              : (nextStatus === "FINISHED"
                ? (transactionRow.type === "IMPORT" ? "IMPORT" : "MANUAL")
                : null),
          },
        });

        fixedCount += 1;
        totalDelta = round2(totalDelta + delta);
        details.push({
          transaction_id: transactionRow.id,
          beneficiary_id: beneficiary.id,
          transaction_type: transactionRow.type,
          before_amount: previousAmount,
          after_amount: nextAmount,
          delta,
          before_remaining_balance: currentRemaining,
          after_remaining_balance: nextRemaining,
          result: "fixed",
        });
      });
    }

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: AUDIT_ACTIONS.FIX_INVALID_SUBUNIT_AMOUNTS,
        metadata: {
          candidates_count: candidates.length,
          fixed_count: fixedCount,
          skipped_count: skippedCount,
          total_delta: totalDelta,
          allowed_values: [0.25, 0.5],
          details,
        },
      },
    });

    if (!actor) {
      revalidatePath("/admin/db-anomalies");
      revalidatePath("/admin/balance-health");
      revalidatePath("/admin/duplicates");
      revalidatePath("/transactions");
    }

    return {
      success: true,
      candidates_count: candidates.length,
      fixed_count: fixedCount,
      skipped_count: skippedCount,
      total_delta: totalDelta,
    };
  } catch (error) {
    console.error("[runFixInvalidSubunitAmountsAction]", error);
    return {
      success: false,
      candidates_count: 0,
      fixed_count: 0,
      skipped_count: 0,
      total_delta: 0,
      error: "تعذر تنفيذ معالجة القيم المخالفة",
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
