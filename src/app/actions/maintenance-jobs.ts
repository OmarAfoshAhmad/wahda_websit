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
import {
  recalcBalancesAction,
  fixStatusAnomaliesAction,
} from "@/app/actions/balance-health-actions";

export type MaintenanceJobTask =
  | { kind: "data_hygiene_sweep"; mode: DataHygieneMode }
  | { kind: "recalc_balances" }
  | { kind: "fix_status_anomalies" }
  | { kind: "parent_card_pattern_fix"; mode: ParentCardPatternFixMode }
  | { kind: "normalize_import_integer_distribution" }
  | { kind: "fix_invalid_subunit_amounts" };

export type MaintenanceJobState = "queued" | "running" | "succeeded" | "failed";

export type MaintenanceJobRecord = {
  id: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  state: MaintenanceJobState;
  task: MaintenanceJobTask;
  summary?: string;
  error?: string;
};

const jobs = new Map<string, MaintenanceJobRecord>();

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
    case "fix_status_anomalies":
      return `تصحيح الحالات: ${Number(r.fixed_count ?? 0).toLocaleString("ar-LY")}`;
    case "parent_card_pattern_fix":
      return `تحويل البطاقات: ${Number(r.processed_count ?? 0).toLocaleString("ar-LY")}`;
    case "normalize_import_integer_distribution":
      return `تصحيح التوزيع: ${Number(r.processed_families ?? 0).toLocaleString("ar-LY")} عائلة`;
    case "fix_invalid_subunit_amounts":
      return `تصحيح الكسور: ${Number(r.fixed_count ?? 0).toLocaleString("ar-LY")}`;
    default:
      return "تم التنفيذ";
  }
}

async function executeTask(task: MaintenanceJobTask, actor: { id: string; username: string }): Promise<unknown> {
  const elevatedActor = { id: actor.id, username: actor.username, isAdmin: true as const };

  switch (task.kind) {
    case "data_hygiene_sweep":
      return runDataHygieneSweepAction({ mode: task.mode, dryRun: false }, elevatedActor);
    case "recalc_balances":
      return recalcBalancesAction(elevatedActor);
    case "fix_status_anomalies":
      return fixStatusAnomaliesAction(elevatedActor);
    case "parent_card_pattern_fix":
      return runParentCardPatternFixAction({ mode: task.mode }, elevatedActor);
    case "normalize_import_integer_distribution":
      return runNormalizeImportIntegerDistributionAction(elevatedActor);
    case "fix_invalid_subunit_amounts":
      return runFixInvalidSubunitAmountsAction(elevatedActor);
    default:
      throw new Error("نوع مهمة غير مدعوم");
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

  const id = generateJobId();
  const record: MaintenanceJobRecord = {
    id,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    createdBy: session.username,
    state: "queued",
    task,
  };

  jobs.set(id, record);

  setTimeout(async () => {
    const queued = jobs.get(id);
    if (!queued) return;

    queued.state = "running";
    queued.startedAt = new Date().toISOString();
    jobs.set(id, queued);

    try {
      const result = await executeTask(task, { id: session.id, username: session.username });
      const asObj = (result ?? {}) as Record<string, unknown>;
      const success = asObj.success !== false;

      const done = jobs.get(id);
      if (!done) return;

      done.state = success ? "succeeded" : "failed";
      done.completedAt = new Date().toISOString();
      done.summary = summarizeResult(task, result);
      done.error = success ? undefined : String(asObj.error ?? "تعذر تنفيذ المهمة");
      jobs.set(id, done);
    } catch (error) {
      const failed = jobs.get(id);
      if (!failed) return;
      failed.state = "failed";
      failed.completedAt = new Date().toISOString();
      failed.error = error instanceof Error ? error.message : "تعذر تنفيذ المهمة";
      jobs.set(id, failed);
    }
  }, 0);

  return { success: true, job: record };
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

  const job = jobs.get(String(jobId).trim());
  if (!job) {
    return { success: false, error: "المهمة غير موجودة" };
  }

  return { success: true, job };
}
