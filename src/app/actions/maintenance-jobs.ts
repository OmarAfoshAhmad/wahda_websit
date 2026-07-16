"use server";

import { getSession } from "@/lib/auth";
import {
  runDataHygieneSweepAction,
  runFixInvalidSubunitAmountsAction,
  runNormalizeImportIntegerDistributionAction,
  runParentCardPatternFixAction,
  type DataHygieneMode,
  type ParentCardPatternFixMode,
} from "@/app/actions/data-hygiene";
import { stabilizeLegacyCardsWithBatch } from "@/app/actions/beneficiary";
import {
  recalcBalancesAction,
  fixStatusAnomaliesAction,
  fixTotalBalanceDriftAction,
} from "@/app/actions/balance-health-actions";
import { applyActiveImportDuplicateFix } from "@/lib/import-duplicate-cases";
import { applyOverdrawnDebtSettlement } from "@/lib/overdrawn-debt-settlement";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type MaintenanceJobTask =
  | { kind: "data_hygiene_sweep"; mode: DataHygieneMode }
  | { kind: "recalc_balances" }
  | { kind: "fix_total_balance_drift" }
  | { kind: "fix_status_anomalies" }
  | { kind: "parent_card_pattern_fix"; mode: ParentCardPatternFixMode }
  | { kind: "normalize_import_integer_distribution" }
  | { kind: "fix_invalid_subunit_amounts" }
  | { kind: "fix_duplicate_import_cases"; facilityId?: string | null }
  | { kind: "settle_overdrawn_debt"; facilityId?: string | null }
  | { kind: "stabilize_legacy_with_batch" }
  | { kind: "purge_legacy_no_payment" };

export type MaintenanceJobState = "queued" | "running" | "succeeded" | "failed";

export type MaintenanceJobProgress = {
  current: number;
  total: number;
  percent: number;
  message?: string;
};

export type MaintenanceJobRecord = {
  id: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  state: MaintenanceJobState;
  task: MaintenanceJobTask;
  progress?: MaintenanceJobProgress;
  summary?: string;
  error?: string;
};

type MaintenanceJobRow = {
  id: string;
  kind: string;
  task: MaintenanceJobTask;
  created_by: string;
  actor_facility_id: string;
  state: MaintenanceJobState;
  progress: MaintenanceJobProgress | null;
  summary: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

function toRecord(row: MaintenanceJobRow): MaintenanceJobRecord {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    createdBy: row.created_by,
    state: row.state,
    task: row.task,
    progress: row.progress ?? undefined,
    summary: row.summary ?? undefined,
    error: row.error_message ?? undefined,
  };
}

async function loadJob(jobId: string): Promise<MaintenanceJobRow | null> {
  const rows = await prisma.$queryRaw<MaintenanceJobRow[]>`
    SELECT id, kind, task, created_by, actor_facility_id, state, progress, summary,
           error_message, created_at, started_at, completed_at, updated_at
    FROM "MaintenanceJob" WHERE id = ${jobId} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function saveProgress(jobId: string, progress: MaintenanceJobProgress) {
  await prisma.$executeRaw`
    UPDATE "MaintenanceJob"
    SET progress = ${JSON.stringify(progress)}::jsonb, updated_at = NOW()
    WHERE id = ${jobId} AND state = 'running'
  `;
}

function generateJobId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `mhj_${Date.now()}_${rand}`;
}

function summarizeResult(task: MaintenanceJobTask, result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  switch (task.kind) {
    case "data_hygiene_sweep":
      return `وضع ${task.mode}: تم التنفيذ`;
    case "recalc_balances":
      return `إصلاح الأرصدة: ${Number(r.fixed_count ?? 0).toLocaleString("ar-LY")} مستفيد`;
    case "fix_total_balance_drift":
      return `إصلاح total_balance: ${Number(r.fixed_count ?? 0).toLocaleString("ar-LY")} مستفيد`;
    case "fix_status_anomalies":
      return `تصحيح الحالات: ${Number(r.fixed_count ?? 0).toLocaleString("ar-LY")}`;
    case "parent_card_pattern_fix":
      return `تحويل البطاقات: ${Number(r.processed_count ?? 0).toLocaleString("ar-LY")} | دمج: ${Number(r.merged_count ?? 0).toLocaleString("ar-LY")} | تخطٍ: ${Number(r.skipped_count ?? 0).toLocaleString("ar-LY")} | تعارض: ${Number(r.conflict_count ?? 0).toLocaleString("ar-LY")}`;
    case "normalize_import_integer_distribution":
      return `تصحيح التوزيع: ${Number(r.processed_families ?? 0).toLocaleString("ar-LY")} عائلة`;
    case "fix_invalid_subunit_amounts":
      return `تصحيح الكسور: ${Number(r.fixed_count ?? 0).toLocaleString("ar-LY")}`;
    case "fix_duplicate_import_cases":
      return `معالجة تكرار IMPORT: ${Number(r.affectedBeneficiaries ?? 0).toLocaleString("ar-LY")} مستفيد`;
    case "settle_overdrawn_debt":
      return `تسوية المديونية: ${Number(r.affectedDebtors ?? 0).toLocaleString("ar-LY")} حالة`;
    case "stabilize_legacy_with_batch":
      return `تحويل البطاقات القديمة ذات الدفعة: ${Number(r.updatedCount ?? 0).toLocaleString("ar-LY")} بطاقة`;
    case "purge_legacy_no_payment":
      return `تصفية القديمة بدون دفعة: تم حذف ${Number(r.updatedCount ?? 0).toLocaleString("ar-LY")} ونقل ${Number(r.totalDeductedTransferred ?? 0).toLocaleString("ar-LY")} د.ل`;
    default:
      return "تم التنفيذ";
  }
}

async function executeTask(
  task: MaintenanceJobTask,
  actor: { id: string; username: string },
  onProgress?: (progress: MaintenanceJobProgress) => void,
): Promise<unknown> {
  const elevatedActor = { id: actor.id, username: actor.username, isAdmin: true as const };

  switch (task.kind) {
    case "data_hygiene_sweep":
      return runDataHygieneSweepAction({ mode: task.mode, dryRun: false }, elevatedActor);
    case "recalc_balances":
      return recalcBalancesAction(elevatedActor);
    case "fix_total_balance_drift":
      return fixTotalBalanceDriftAction(elevatedActor);
    case "fix_status_anomalies":
      return fixStatusAnomaliesAction(elevatedActor);
    case "parent_card_pattern_fix":
      return runParentCardPatternFixAction({
        mode: task.mode,
        onProgress: (progress) => {
          const total = Math.max(1, Number(progress.total) || 1);
          const current = Math.max(0, Math.min(total, Number(progress.examined) || 0));
          const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
          onProgress?.({
            current,
            total,
            percent,
            message: `تمت معالجة ${current}/${total} (نجح: ${progress.processed}، تخطٍ: ${progress.skipped})`,
          });
        },
      }, elevatedActor);
    case "normalize_import_integer_distribution":
      return runNormalizeImportIntegerDistributionAction(elevatedActor);
    case "fix_invalid_subunit_amounts":
      return runFixInvalidSubunitAmountsAction(elevatedActor);
    case "fix_duplicate_import_cases":
      return applyActiveImportDuplicateFix({
        user: actor.username,
        facilityId: task.facilityId ?? actor.id,
      });
    case "settle_overdrawn_debt":
      return applyOverdrawnDebtSettlement({
        user: actor.username,
        facilityId: task.facilityId ?? actor.id,
      });
    case "stabilize_legacy_with_batch": {
      const result = await stabilizeLegacyCardsWithBatch();
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    }
    case "purge_legacy_no_payment": {
      const { purgeLegacyNoPayment } = await import("@/app/actions/beneficiary");
      const result = await purgeLegacyNoPayment();
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    }
    default:
      throw new Error("نوع مهمة غير مدعوم");
  }
}

export async function startMaintenanceJobForActor(
  task: MaintenanceJobTask,
  actor: { id: string; username: string; isAdmin: boolean },
): Promise<{ success: boolean; job?: MaintenanceJobRecord; error?: string }> {
  if (!actor.isAdmin) {
    return { success: false, error: "غير مصرح" };
  }

  const id = generateJobId();
  try {
    await prisma.$executeRaw`
      INSERT INTO "MaintenanceJob" (id, kind, task, created_by, actor_facility_id, state, created_at, updated_at)
      VALUES (${id}, ${task.kind}, ${JSON.stringify(task)}::jsonb, ${actor.username}, ${actor.id}, 'queued', NOW(), NOW())
    `;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: "توجد مهمة من النوع نفسه قيد التنفيذ؛ انتظر اكتمالها" };
    }
    // Raw PostgreSQL unique violations are surfaced as P2010 by Prisma.
    if (String(error).includes("MaintenanceJob_one_active_kind_idx") || String(error).includes("23505")) {
      return { success: false, error: "توجد مهمة من النوع نفسه قيد التنفيذ؛ انتظر اكتمالها" };
    }
    throw error;
  }

  const queued = await loadJob(id);
  if (!queued) return { success: false, error: "تعذر إنشاء سجل المهمة" };
  setTimeout(() => { void runPersistedMaintenanceJob(id); }, 0);
  return { success: true, job: toRecord(queued) };
}

async function runPersistedMaintenanceJob(jobId: string): Promise<void> {
  const claimed = await prisma.$executeRaw`
    UPDATE "MaintenanceJob"
    SET state = 'running', started_at = NOW(), updated_at = NOW(),
        progress = ${JSON.stringify({ current: 0, total: 1, percent: 0, message: "بدأ التنفيذ" })}::jsonb
    WHERE id = ${jobId} AND state = 'queued'
  `;
  if (claimed !== 1) return;

  const job = await loadJob(jobId);
  if (!job) return;
  try {
    const result = await executeTask(job.task, { id: job.actor_facility_id, username: job.created_by }, (progress) => {
      void saveProgress(jobId, progress);
    });
    const asObj = (result ?? {}) as Record<string, unknown>;
    const success = asObj.success !== false;
    const finalProgress = { current: 1, total: 1, percent: 100, message: success ? "اكتملت المهمة بنجاح" : "فشلت المهمة" };
    await prisma.$executeRaw`
      UPDATE "MaintenanceJob"
      SET state = ${success ? "succeeded" : "failed"}, completed_at = NOW(), updated_at = NOW(),
          summary = ${summarizeResult(job.task, result)},
          error_message = ${success ? null : String(asObj.error ?? "تعذر تنفيذ المهمة")},
          progress = ${JSON.stringify(finalProgress)}::jsonb
      WHERE id = ${jobId} AND state = 'running'
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر تنفيذ المهمة";
    await prisma.$executeRaw`
      UPDATE "MaintenanceJob"
      SET state = 'failed', completed_at = NOW(), updated_at = NOW(), error_message = ${message},
          progress = ${JSON.stringify({ current: 0, total: 1, percent: 100, message: "فشلت المهمة" })}::jsonb
      WHERE id = ${jobId} AND state = 'running'
    `;
  }
}

export async function startMaintenanceJobAction(task: MaintenanceJobTask): Promise<{
  success: boolean;
  job?: MaintenanceJobRecord;
  error?: string;
}> {
  const session = await getSession();
  if (!session?.is_admin) {
    return { success: false, error: "غير مصرح" };
  }

  return startMaintenanceJobForActor(task, {
    id: session.id,
    username: session.username,
    isAdmin: true,
  });
}

export async function getMaintenanceJobAction(jobId: string): Promise<{
  success: boolean;
  job?: MaintenanceJobRecord;
  error?: string;
}> {
  const session = await getSession();
  if (!session?.is_admin) {
    return { success: false, error: "غير مصرح" };
  }

  const normalizedId = String(jobId).trim();
  let job = await loadJob(normalizedId);
  if (!job) {
    return { success: false, error: "المهمة غير موجودة" };
  }

  if (job.state === "queued") {
    setTimeout(() => { void runPersistedMaintenanceJob(normalizedId); }, 0);
  } else if (job.state === "running" && job.updated_at.getTime() < Date.now() - 30 * 60 * 1000) {
    await prisma.$executeRaw`
      UPDATE "MaintenanceJob" SET state = 'failed', completed_at = NOW(), updated_at = NOW(),
        error_message = 'توقف الخادم أثناء التنفيذ؛ لم تُعد المهمة تلقائياً لمنع تكرار الأثر المالي'
      WHERE id = ${normalizedId} AND state = 'running' AND updated_at < NOW() - INTERVAL '30 minutes'
    `;
    job = await loadJob(normalizedId) ?? job;
  }

  return { success: true, job: toRecord(job) };
}
