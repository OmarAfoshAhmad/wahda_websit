"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/constants";

const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_AUDIT_RETENTION_DAYS = 180;
const DEFAULT_JOBS_RETENTION_DAYS = 30;
const LOCKED_DELETED_FACILITY_HASH = "$2b$10$t36NxAKrnxJr4x3CH.mgNuHTj3EsRibdaGT2EoXwJZS1ki4do6X6e";
const RESET_REQUIRED_FACILITY_HASH = "$2b$10$zIN5eU5a4P.45wgaiqCJzuw2vPDgNdYT1Lmr6eeHxndRxzS3rLsb6";

type SweepRequest = {
  dryRun?: boolean;
  mode?: DataHygieneMode;
  notificationRetentionDays?: number;
  auditRetentionDays?: number;
  jobsRetentionDays?: number;
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

function clampDays(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(3650, Math.max(1, Math.floor(value)));
}

export async function runDataHygieneSweepAction(
  request: SweepRequest = {}
): Promise<DataHygieneSweepResult> {
  const session = await getSession();
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
            AND (
              f.must_change_password = false
              OR f.password_hash <> ${LOCKED_DELETED_FACILITY_HASH}
            )
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

      if (mode === "deleted_facilities") {
        await tx.$executeRaw`
          UPDATE "Facility" f
          SET
            password_hash = ${LOCKED_DELETED_FACILITY_HASH},
            must_change_password = true
          WHERE f.deleted_at IS NOT NULL
            AND (
              f.must_change_password = false
              OR f.password_hash <> ${LOCKED_DELETED_FACILITY_HASH}
            )
        `;
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
            deleted_facilities_lock_normalized: deletedFacilitiesCount,
            orphaned_notifications_deleted: orphanedCount,
            old_read_notifications_deleted: oldReadCount,
            old_login_audit_logs_deleted: oldLoginAuditCount,
            old_import_jobs_deleted: oldImportJobsCount,
            old_restore_jobs_deleted: oldRestoreJobsCount,
          },
        },
      });
    });

    revalidatePath("/admin/db-anomalies");
    revalidatePath("/admin/balance-health");
    revalidatePath("/admin/duplicates");
    revalidatePath("/transactions");

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
