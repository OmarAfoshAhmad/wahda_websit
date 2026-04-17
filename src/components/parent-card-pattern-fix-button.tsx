"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { type ParentCardPatternFixMode } from "@/app/actions/data-hygiene";
import { startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";

type Props = {
  totalCount: number;
  visibleCount: number;
  invalidH2Count: number;
  motherPlainCount: number;
  fatherPlainCount: number;
  motherNumberedCount: number;
  fatherNumberedCount: number;
};

const MODE_LABELS: Record<ParentCardPatternFixMode, string> = {
  all_to_numbered: "تحويل الكل إلى M1/F1",
  all_to_plain: "تحويل الكل إلى M/F",
  h2_to_h1_only: "تصحيح H2 إلى H1 فقط",
};

export function ParentCardPatternFixButton({
  totalCount,
  visibleCount,
  invalidH2Count,
  motherPlainCount,
  fatherPlainCount,
  motherNumberedCount,
  fatherNumberedCount,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mode, setMode] = useState<ParentCardPatternFixMode>("all_to_numbered");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const runFix = () => {
    setError(null);
    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "parent_card_pattern_fix", mode });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء المعالجة بالخلفية");
        return;
      }
      setStatusMessage(`تم بدء المعالجة بالخلفية (رقم المهمة: ${queued.job.id}) للنمط: ${MODE_LABELS[mode]}.`);
      setConfirmOpen(false);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/60">
          إجمالي الحالات العامة: <strong>{totalCount.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/60">
          الظاهر في الجدول: <strong>{visibleCount.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          H2 غير صالح: <strong>{invalidH2Count.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
          M بدون رقم: <strong>{motherPlainCount.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
          F بدون رقم: <strong>{fatherPlainCount.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400">
          M1 مرقم: <strong>{motherNumberedCount.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400">
          F1 مرقم: <strong>{fatherNumberedCount.toLocaleString("ar-LY")}</strong>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ParentCardPatternFixMode)}
          disabled={isPending}
          className="h-10 min-w-55 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 outline-none ring-0 transition-colors focus:border-slate-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="all_to_numbered">تحويل M/F إلى M1/F1 + تصحيح H2 إلى H1</option>
          <option value="all_to_plain">تحويل M1/F1 إلى M/F + تصحيح H2 إلى H1</option>
          <option value="h2_to_h1_only">تصحيح H2 إلى H1 فقط</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
          disabled={isPending || totalCount === 0}
          className="inline-flex h-10 w-56 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          تنفيذ تحويل نمط البطاقات
        </button>
      </div>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
        أمثلة: <strong>WAB2025123M</strong> ⇄ <strong>WAB2025123M1</strong>،
        <strong> WAB2025123F</strong> ⇄ <strong>WAB2025123F1</strong>،
        <strong> WAB2025123H2</strong> ← غير صالح وسيُصحح إلى <strong>WAB2025123H1</strong>.
      </p>

      <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        ماذا يفعل كل خيار:
        {" "}<strong>all_to_numbered</strong> يحول فقط M/F إلى M1/F1،
        {" "}<strong>all_to_plain</strong> يحول فقط M1/F1 إلى M/F،
        {" "}<strong>h2_to_h1_only</strong> يصحح H2 إلى H1 دون تغيير M/F.
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
        title="تأكيد تحويل نمط بطاقات الأب/الأم"
        description={`سيتم تنفيذ: ${MODE_LABELS[mode]}. هذا الإجراء يعدل رقم البطاقة مباشرة ويُسجل في سجل التدقيق.`}
        confirmLabel="نعم، نفذ التحويل"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={null}
      />
    </div>
  );
}
