"use client";

import { useState, useTransition } from "react";
import { Wrench, Loader2 } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { recalcBalancesAction, type RecalcResult } from "@/app/actions/balance-health-actions";

export function FixBalancesButton() {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecalcResult | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await recalcBalancesAction();
      if (res.success) {
        setConfirmOpen(false);
        setResult(res);
      } else {
        setError(res.error ?? "حدث خطأ غير متوقع");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-3">
      <button
        type="button"
        onClick={() => { setResult(null); setError(null); setConfirmOpen(true); }}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
        إصلاح تلقائي للأرصدة
      </button>

      {result && result.fixed_count === 0 && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
          جميع الأرصدة صحيحة — لا تعديلات مطلوبة
        </p>
      )}
      {result && result.fixed_count > 0 && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
          تم إصلاح {result.fixed_count.toLocaleString("ar-LY")} مستفيد
          {result.status_changes > 0 && ` · تغيّرت حالة ${result.status_changes.toLocaleString("ar-LY")}`}
          {` · إجمالي الانحراف: ${result.total_drift.toFixed(2)} د.ل`}
        </p>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="تأكيد إصلاح الأرصدة"
        description="سيتم إعادة حساب remaining_balance وتحديث حالة (ACTIVE/FINISHED) لجميع المستفيدين الذين توجد لديهم أرصدة غير متطابقة. هذه العملية لا يمكن التراجع عنها."
        confirmLabel="نعم، إصلاح الأرصدة"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={error}
      />
    </div>
  );
}
