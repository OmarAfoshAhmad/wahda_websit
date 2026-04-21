"use client";

import { useState, useTransition } from "react";
import { Loader2, Wrench } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";
import { useMaintenanceJobProgress } from "@/components/use-maintenance-job-progress";
import { useRouter } from "next/navigation";

export function FixTotalBalancesButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const job = useMaintenanceJobProgress(jobId, (result) => {
    if (result.success) {
      setStatusMessage(`${result.summary ?? "اكتملت المعالجة"}. تم تحديث القائمة.`);
      setError(null);
      setJobId(null);
      router.refresh();
      return;
    }
    setError(result.error ?? "فشلت المهمة");
    setJobId(null);
  });
  const isRunning = isPending || job.isRunning;

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "fix_total_balance_drift" });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء المعالجة بالخلفية");
        return;
      }
      setJobId(queued.job.id);
      setStatusMessage(`تم بدء المعالجة بالخلفية (رقم المهمة: ${queued.job.id}).`);
      setConfirmOpen(false);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => { setError(null); setConfirmOpen(true); }}
        disabled={isRunning}
        className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
      >
        {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
        إصلاح انجراف الرصيد الكلي
      </button>

      {jobId && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs min-w-80">
          <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
            <span className="font-bold">الحالة: {job.jobState === "queued" ? "في الانتظار" : "جارية"}</span>
            <span>التقدم: {Math.max(0, Math.min(100, job.progress))}%</span>
            {job.total > 0 && <span>المعالج: {job.current.toLocaleString("ar-LY")} / {job.total.toLocaleString("ar-LY")}</span>}
            <span>{job.elapsedSeconds} ث</span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.max(3, Math.min(100, job.progress))}%` }} />
          </div>
          {job.message && <p className="mt-2 text-slate-600 dark:text-slate-400">{job.message}</p>}
        </div>
      )}

      {statusMessage && (
        <span className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400">
          {statusMessage}
        </span>
      )}

      {error && (
        <span className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </span>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isRunning && setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="إصلاح انجراف الرصيد الكلي (total_balance)"
        description="سيتم البحث عن المستفيدين الذين remaining_balance > 0 لكن total_balance أقل مما ينبغي (total_balance < remaining_balance + مجموع الحركات)، وتصحيح total_balance. هذا يمنع فشل عمليات الخصم بسبب BALANCE_GUARD_INVARIANT_FAILED."
        confirmLabel="نعم، نفذ الإصلاح"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isRunning}
        error={null}
      />
    </div>
  );
}
