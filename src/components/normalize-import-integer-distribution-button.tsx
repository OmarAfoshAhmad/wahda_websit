"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { runNormalizeImportIntegerDistributionAction, type ImportIntegerDistributionFixResult } from "@/app/actions/data-hygiene";

type Props = {
  totalFamilies: number;
  visibleFamilies: number;
};

export function NormalizeImportIntegerDistributionButton({ totalFamilies, visibleFamilies }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportIntegerDistributionFixResult | null>(null);

  const runFix = () => {
    setError(null);
    startTransition(async () => {
      const res = await runNormalizeImportIntegerDistributionAction();
      if (!res.success) {
        setError(res.error ?? "تعذر تنفيذ التصحيح");
        return;
      }
      setResult(res);
      setConfirmOpen(false);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/60">
          إجمالي العائلات المتأثرة: <strong>{totalFamilies.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/60">
          الظاهر في الجدول: <strong>{visibleFamilies.toLocaleString("ar-LY")}</strong>
        </span>
      </div>

      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={isPending || totalFamilies === 0}
        className="inline-flex h-10 w-80 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        تنفيذ تصحيح التوزيع الصحيح (بدون كسور)
      </button>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
        سيتم: توحيد خصم الاستيراد لكل عائلة إلى أعداد صحيحة فقط، دمج أي تكرارات زائدة، وحفظ لقطة تراجع في سجل المراقبة.
      </p>

      {result && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
          تمت المعالجة: {result.processed_families.toLocaleString("ar-LY")} عائلة
          {` · أفراد: ${result.processed_members.toLocaleString("ar-LY")}`}
          {` · تحديث حركات: ${result.updated_transactions.toLocaleString("ar-LY")}`}
          {` · إنشاء حركات: ${result.created_transactions.toLocaleString("ar-LY")}`}
          {` · إلغاء تكرارات: ${result.cancelled_transactions.toLocaleString("ar-LY")}`}
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
        title="تأكيد تصحيح توزيع الاستيراد المجمع"
        description="سيتم تعديل الحالات التاريخية ذات الحصص العشرية إلى توزيع صحيح بدون كسور، مع تسجيل كامل في سجل التدقيق وإمكانية التراجع."
        confirmLabel="نعم، نفذ التصحيح"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={null}
      />
    </div>
  );
}
