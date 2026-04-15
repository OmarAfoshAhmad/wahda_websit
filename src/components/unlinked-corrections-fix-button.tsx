"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { runDataHygieneSweepAction } from "@/app/actions/data-hygiene";
import { ConfirmationModal } from "@/components/confirmation-modal";

type Props = {
  initialCount: number;
};

export function UnlinkedCorrectionsFixButton({ initialCount }: Props) {
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAffected, setLastAffected] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const runFix = () => {
    setError(null);
    setStatusMessage(null);
    startTransition(async () => {
      const res = await runDataHygieneSweepAction({ mode: "unlinked_corrections", dryRun: false });
      if (!res.success) {
        setError(res.error ?? "تعذر تنفيذ المعالجة");
        return;
      }
      setLastAffected(res.unlinked_corrections);
      if (res.unlinked_corrections === 0) {
        setStatusMessage("لا توجد حركات غير مرتبطة قابلة للمعالجة حاليا. ربما تمت معالجتها سابقا.");
      } else {
        setStatusMessage(`تم تنفيذ المعالجة على ${res.unlinked_corrections.toLocaleString("ar-LY")} حركة.`);
      }

      const dryRes = await runDataHygieneSweepAction({ mode: "unlinked_corrections", dryRun: true });
      if (dryRes.success) {
        setCount(dryRes.unlinked_corrections);
      }
      setConfirmOpen(false);
    });
  };

  const runQuickCheck = () => {
    setError(null);
    setStatusMessage(null);
    startTransition(async () => {
      const res = await runDataHygieneSweepAction({ mode: "unlinked_corrections", dryRun: true });
      if (!res.success) {
        setError(res.error ?? "تعذر تنفيذ الفحص");
        return;
      }
      setCount(res.unlinked_corrections);
      setLastAffected(null);
      if (res.unlinked_corrections === 0) {
        setStatusMessage("الفحص: لا توجد حاليا حالات غير مرتبطة قابلة للمعالجة.");
      } else {
        setStatusMessage(`الفحص: تم العثور على ${res.unlinked_corrections.toLocaleString("ar-LY")} حالة قابلة للمعالجة.`);
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runQuickCheck}
          disabled={isPending}
          className="inline-flex h-10 w-56 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          فحص الحركات غير المرتبطة ({count.toLocaleString("ar-LY")})
        </button>

        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={isPending}
          className="inline-flex h-10 w-56 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          معالجة الحركات غير المرتبطة
        </button>
      </div>

      {lastAffected !== null && (
        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
          تمت معالجة {lastAffected.toLocaleString("ar-LY")} حركة غير مرتبطة.
        </p>
      )}

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
        title="تأكيد معالجة الحركات غير المرتبطة"
        description="سيتم وضع الحركات المصححة غير المرتبطة (بدون مرجع حركة أصلية) كملغاة بشكل آمن."
        confirmLabel="نعم، نفذ المعالجة"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={null}
      />
    </div>
  );
}
