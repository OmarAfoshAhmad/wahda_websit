"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/constants";

const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_AUDIT_RETENTION_DAYS = 180;
const DEFAULT_JOBS_RETENTION_DAYS = 30;

type SweepRequest = {
  dryRun?: boolean;
  mode?: DataHygieneMode;
  notificationRetentionDays?: number;
  auditRetentionDays?: number;
  jobsRetentionDays?: number;
};

export type DataHygieneMode =
  | "all"
  | "orphaned_notifications"
  | "old_read_notifications"
  | "old_login_audit_logs"
  | "old_import_jobs"
  | "old_restore_jobs";

export type DataHygieneSweepResult = {
  success: boolean;
  dryRun: boolean;
  mode: DataHygieneMode;
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
    const [orphanedCount, oldReadCount, oldLoginAuditCount, oldImportJobsCount, oldRestoreJobsCount] =
      await Promise.all([
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

    return {
      success: true,
      dryRun: false,
      mode,
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
      orphaned_notifications: 0,
      old_read_notifications: 0,
      old_login_audit_logs: 0,
      old_import_jobs: 0,
      old_restore_jobs: 0,
      error: "تعذّر تنفيذ التنظيف",
    };
  }
}
