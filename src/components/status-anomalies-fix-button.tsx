"use client";

import { useState, useTransition } from "react";
import { Loader2, Wrench } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { fixStatusAnomaliesAction } from "@/app/actions/balance-health-actions";

export function StatusAnomaliesFixButton() {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ fixedCount: number; a2f: number; f2a: number } | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await fixStatusAnomaliesAction();
      if (!res.success) {
        setError(res.error ?? "تعذر تنفيذ المعالجة");
        return;
      }
      setConfirmOpen(false);
      setResult({
        fixedCount: res.fixed_count,
        a2f: res.active_to_finished,
        f2a: res.finished_to_active,
      });
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={isPending}
        className="inline-flex h-10 w-56 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
        معالجة تناقض الحالة
      </button>

      {result && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
          تمت المعالجة: {result.fixedCount.toLocaleString("ar-LY")} حالة
          {` · نشط→مكتمل ${result.a2f.toLocaleString("ar-LY")}`}
          {` · مكتمل→نشط ${result.f2a.toLocaleString("ar-LY")}`}
        </p>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="تأكيد معالجة تناقض الحالة"
        description="سيتم تصحيح حالة المستفيدين الذين حالتهم لا تتوافق مع الرصيد الحالي."
        confirmLabel="نعم، نفذ المعالجة"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={error}
      />
    </div>
  );
}
