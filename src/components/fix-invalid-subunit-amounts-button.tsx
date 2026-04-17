"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";

type Props = {
  totalCandidates: number;
  visibleCandidates: number;
};

export function FixInvalidSubunitAmountsButton({ totalCandidates, visibleCandidates }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const runFix = () => {
    setError(null);
    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "fix_invalid_subunit_amounts" });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء المعالجة بالخلفية");
        return;
      }
      setStatusMessage(`تم بدء معالجة القيم المخالفة بالخلفية (رقم المهمة: ${queued.job.id}).`);
      setConfirmOpen(false);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/60">
          إجمالي الحالات: <strong>{totalCandidates.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/60">
          الظاهر في الجدول: <strong>{visibleCandidates.toLocaleString("ar-LY")}</strong>
        </span>
      </div>

      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={isPending || totalCandidates === 0}
        className="inline-flex h-10 w-80 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        معالجة القيم المخالفة
      </button>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
        سيتم تعديل أي قيمة موجبة أقل من 1 (وليست 0.25 أو 0.50) إلى أقرب قيمة مسموحة، مع تحديث الرصيد المتبقي وتسجيل كامل في التدقيق.
      </p>

      {statusMessage && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400">
          {statusMessage}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </p>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        onConfirm={runFix}
        title="تأكيد معالجة القيم المخالفة"
        description="سيتم تعديل القيم المخالفة الأقل من 1 إلى 0.25 أو 0.50 حسب الأقرب، وتحديث الأرصدة المتبقية تلقائيا مع حفظ سجل تدقيق كامل."
        confirmLabel="نعم، نفذ المعالجة"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={null}
      />
    </div>
  );
}
