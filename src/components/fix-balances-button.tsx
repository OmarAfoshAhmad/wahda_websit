"use client";

import { useState, useTransition } from "react";
import { Wrench, Loader2, SearchCheck } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { checkBalanceDriftAction, recalcBalancesAction, type RecalcResult } from "@/app/actions/balance-health-actions";

export function FixBalancesButton() {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecalcResult | null>(null);
  const [checkResult, setCheckResult] = useState<{ count: number; totalDrift: number } | null>(null);

  const handleCheck = () => {
    setError(null);
    startTransition(async () => {
      const res = await checkBalanceDriftAction();
      if (!res.success) {
        setError(res.error ?? "تعذر فحص الانجراف");
        return;
      }
      setCheckResult({ count: res.count, totalDrift: res.total_drift });
    });
  };

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
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCheck}
          disabled={isPending}
          className="inline-flex h-10 w-56 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
          فحص انجراف الرصيد
        </button>

        <button
          type="button"
          onClick={() => { setResult(null); setError(null); setConfirmOpen(true); }}
          disabled={isPending}
          className="inline-flex h-10 w-56 items-center justify-center gap-2 rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
          إصلاح تلقائي للأرصدة
        </button>
      </div>

      {checkResult && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400">
          نتيجة الفحص: {checkResult.count.toLocaleString("ar-LY")} مستفيد · إجمالي الانجراف {checkResult.totalDrift.toFixed(2)} د.ل
        </p>
      )}

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
