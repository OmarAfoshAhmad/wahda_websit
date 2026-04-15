"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCcw, ShieldCheck } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import {
  runDataHygieneSweepAction,
  type DataHygieneMode,
  type DataHygieneSweepResult,
} from "@/app/actions/data-hygiene";

type Props = {
  counts?: {
    unlinked_corrections?: number;
    duplicate_movements?: number;
    invalid_password_facilities?: number;
    deleted_facilities?: number;
    orphaned_notifications: number;
    old_read_notifications: number;
    old_login_audit_logs: number;
    old_import_jobs: number;
    old_restore_jobs: number;
  };
};

type HygieneCounts = {
  unlinked_corrections: number;
  duplicate_movements: number;
  invalid_password_facilities: number;
  deleted_facilities: number;
  orphaned_notifications: number;
  old_read_notifications: number;
  old_login_audit_logs: number;
  old_import_jobs: number;
  old_restore_jobs: number;
};

const ZERO_COUNTS: HygieneCounts = {
  unlinked_corrections: 0,
  duplicate_movements: 0,
  invalid_password_facilities: 0,
  deleted_facilities: 0,
  orphaned_notifications: 0,
  old_read_notifications: 0,
  old_login_audit_logs: 0,
  old_import_jobs: 0,
  old_restore_jobs: 0,
};

const MODE_LABELS: Record<DataHygieneMode, string> = {
  all: "الكل",
  unlinked_corrections: "الحركات غير المرتبطة",
  duplicate_movements: "تكرارات الحركات",
  invalid_password_facilities: "مرافق كلمة مرور غير صالحة",
  deleted_facilities: "مرافق محذوفة",
  orphaned_notifications: "الإشعارات اليتيمة",
  old_read_notifications: "الإشعارات المقروءة القديمة",
  old_login_audit_logs: "سجلات الدخول/الخروج القديمة",
  old_import_jobs: "وظائف الاستيراد القديمة",
  old_restore_jobs: "وظائف الاستعادة القديمة",
};

export function DataHygieneSweepButton({ counts }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<DataHygieneSweepResult | null>(null);
  const [pendingMode, setPendingMode] = useState<DataHygieneMode>("all");
  const [liveCounts, setLiveCounts] = useState<HygieneCounts>({
    ...ZERO_COUNTS,
    ...(counts ?? {}),
  });

  useEffect(() => {
    setLiveCounts({
      ...ZERO_COUNTS,
      ...(counts ?? {}),
    });
  }, [counts]);

  const runSweep = (mode: DataHygieneMode, dryRun: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await runDataHygieneSweepAction({ mode, dryRun });
      if (!res.success) {
        setError(res.error ?? "حدث خطأ غير متوقع");
        return;
      }
      setResult(res);
      setLiveCounts({
        unlinked_corrections: res.unlinked_corrections,
        duplicate_movements: res.duplicate_movements,
        invalid_password_facilities: res.invalid_password_facilities,
        deleted_facilities: res.deleted_facilities,
        orphaned_notifications: res.orphaned_notifications,
        old_read_notifications: res.old_read_notifications,
        old_login_audit_logs: res.old_login_audit_logs,
        old_import_jobs: res.old_import_jobs,
        old_restore_jobs: res.old_restore_jobs,
      });
      if (!dryRun) setConfirmOpen(false);
    });
  };

  const candidateCountByMode = (mode: DataHygieneMode) => {
    if (mode === "all") {
      return (
        liveCounts.orphaned_notifications +
        liveCounts.old_read_notifications +
        liveCounts.old_login_audit_logs +
        liveCounts.old_import_jobs +
        liveCounts.old_restore_jobs
      );
    }

    return liveCounts[mode] ?? 0;
  };

  const totalAffected = result
    ? result.orphaned_notifications +
      result.old_read_notifications +
      result.old_login_audit_logs +
      result.old_import_jobs +
      result.old_restore_jobs
    : 0;

  const openConfirm = (mode: DataHygieneMode) => {
    setPendingMode(mode);
    setConfirmOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => runSweep("all", true)}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          فحص سريع
        </button>

        <button
          type="button"
          onClick={() => openConfirm("all")}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-[#0f2a4a] px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          تنظيف السجلات القديمة واليتيمة
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => openConfirm("orphaned_notifications")}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          معالجة الإشعارات اليتيمة ({candidateCountByMode("orphaned_notifications").toLocaleString("ar-LY")})
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => openConfirm("old_read_notifications")}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          معالجة الإشعارات المقروءة القديمة ({candidateCountByMode("old_read_notifications").toLocaleString("ar-LY")})
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => openConfirm("old_login_audit_logs")}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          معالجة سجلات الدخول/الخروج القديمة ({candidateCountByMode("old_login_audit_logs").toLocaleString("ar-LY")})
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => openConfirm("old_import_jobs")}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          معالجة وظائف الاستيراد القديمة ({candidateCountByMode("old_import_jobs").toLocaleString("ar-LY")})
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => openConfirm("old_restore_jobs")}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          معالجة وظائف الاستعادة القديمة ({candidateCountByMode("old_restore_jobs").toLocaleString("ar-LY")})
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/60">
          <p className="font-bold text-slate-800 dark:text-slate-200">
            {result.dryRun ? "نتيجة الفحص" : `نتيجة معالجة ${MODE_LABELS[result.mode]}`}: {totalAffected.toLocaleString("ar-LY")} سجل
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            إشعارات يتيمة: {result.orphaned_notifications.toLocaleString("ar-LY")}
            {" | "}
            إشعارات قديمة مقروءة: {result.old_read_notifications.toLocaleString("ar-LY")}
            {" | "}
            سجلات دخول قديمة: {result.old_login_audit_logs.toLocaleString("ar-LY")}
            {" | "}
            وظائف استيراد قديمة: {result.old_import_jobs.toLocaleString("ar-LY")}
            {" | "}
            وظائف استعادة قديمة: {result.old_restore_jobs.toLocaleString("ar-LY")}
          </p>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        onConfirm={() => runSweep(pendingMode, false)}
        title="تأكيد تنظيف قاعدة البيانات"
        description={`سيتم تنفيذ معالجة من نوع: ${MODE_LABELS[pendingMode]}. هذا الإجراء يحذف سجلات آمنة فقط.`}
        confirmLabel={`نعم، نفذ ${MODE_LABELS[pendingMode]}`}
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={null}
      />
    </div>
  );
}
