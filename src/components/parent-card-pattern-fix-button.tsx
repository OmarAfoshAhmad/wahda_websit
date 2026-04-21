"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, ShieldCheck, Clock3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { type ParentCardPatternFixMode } from "@/app/actions/data-hygiene";
import { getMaintenanceJobAction, startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";

type Props = {
  totalCount: number;
  visibleCount: number;
  invalidH2Count: number;
  wifePlainCount: number;
  motherPlainCount: number;
  fatherPlainCount: number;
};

const MODE_LABELS: Record<ParentCardPatternFixMode, string> = {
  all_to_numbered: "تحويل الكل إلى W1/M1/F1/H1",
  all_to_plain: "تحويل الكل إلى W/M/F",
  h2_to_h1_only: "تصحيح H2 إلى H1 فقط",
};

const ACTIVE_PARENT_CARD_JOB_KEY = "active_parent_card_pattern_fix_job";

export function ParentCardPatternFixButton({
  totalCount,
  visibleCount,
  invalidH2Count,
  wifePlainCount,
  motherPlainCount,
  fatherPlainCount,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mode, setMode] = useState<ParentCardPatternFixMode>("all_to_numbered");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<"queued" | "running" | "succeeded" | "failed" | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [totalCountInJob, setTotalCountInJob] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(ACTIVE_PARENT_CARD_JOB_KEY);
    if (!stored) return;
    setJobId(stored);
    setStatusMessage(`تم استئناف متابعة المهمة ${stored} من المتصفح.`);
    setProgress(8);
  }, []);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const tick = async () => {
      const status = await getMaintenanceJobAction(jobId);
      if (cancelled) return;

      if (!status.success || !status.job) {
        setError(status.error ?? "تعذر جلب حالة مهمة تحويل النمط.");
        return;
      }

      const job = status.job;
      setJobState(job.state);

      const base = new Date(job.startedAt ?? job.createdAt).getTime();
      const now = Date.now();
      setElapsedSeconds(Math.max(0, Math.floor((now - base) / 1000)));

      if (job.progress) {
        setProcessedCount(Math.max(0, Number(job.progress.current) || 0));
        setTotalCountInJob(Math.max(0, Number(job.progress.total) || 0));
        setProgress(Math.max(0, Math.min(100, Number(job.progress.percent) || 0)));
      }

      if (job.state === "queued") {
        setProgress((p) => Math.max(10, Math.min(20, p + 2)));
        setStatusMessage(`المهمة ${job.id} في قائمة الانتظار...`);
        return;
      }

      if (job.state === "running") {
        setProgress((p) => Math.max(22, Math.min(95, p + 3)));
        setStatusMessage(job.progress?.message ?? `المهمة ${job.id} قيد التنفيذ بالخلفية.`);
        return;
      }

      if (job.state === "succeeded") {
        setProgress(100);
        const summary = job.summary ?? `اكتملت المهمة ${job.id} بنجاح.`;
        const changedMatch = summary.match(/تحويل البطاقات:\s*([0-9.,\u0660-\u0669]+)/);
        const changedRaw = changedMatch?.[1] ?? "0";
        const normalizedChanged = Number(changedRaw.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/,/g, ""));
        if (Number.isFinite(normalizedChanged) && normalizedChanged > 0) {
          setStatusMessage(`${summary} تم تحديث القائمة وإخفاء الحالات المعالجة.`);
        } else {
          setStatusMessage(`${summary} لم يتم تعديل أي بطاقة، راجع سبب التخطي/التعارض.`);
        }
        window.localStorage.removeItem(ACTIVE_PARENT_CARD_JOB_KEY);
        setJobId(null);
        router.refresh();
        return;
      }

      setProgress(100);
      setError(job.error ?? `فشلت المهمة ${job.id}.`);
      setStatusMessage(`فشلت المهمة ${job.id}.`);
      window.localStorage.removeItem(ACTIVE_PARENT_CARD_JOB_KEY);
      setJobId(null);
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, router]);

  const isRunning = Boolean(jobId) || isPending;
  const stateLabel = useMemo(() => {
    if (jobState === "queued") return "في الانتظار";
    if (jobState === "running") return "جارية";
    if (jobState === "succeeded") return "اكتملت";
    if (jobState === "failed") return "فشلت";
    return "جاهزة";
  }, [jobState]);

  const runFix = () => {
    setError(null);
    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "parent_card_pattern_fix", mode });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء المعالجة بالخلفية");
        return;
      }
      setJobId(queued.job.id);
      setJobState("queued");
      setProgress(10);
      setProcessedCount(0);
      setTotalCountInJob(0);
      setElapsedSeconds(0);
      setStatusMessage(`تم بدء المعالجة بالخلفية (رقم المهمة: ${queued.job.id}) للنمط: ${MODE_LABELS[mode]}.`);
      window.localStorage.setItem(ACTIVE_PARENT_CARD_JOB_KEY, queued.job.id);
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
        <span className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
          W بدون رقم: <strong>{wifePlainCount.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
          M بدون رقم: <strong>{motherPlainCount.toLocaleString("ar-LY")}</strong>
        </span>
        <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-400">
          F بدون رقم: <strong>{fatherPlainCount.toLocaleString("ar-LY")}</strong>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ParentCardPatternFixMode)}
          disabled={isRunning}
          className="h-10 min-w-55 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 outline-none ring-0 transition-colors focus:border-slate-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="all_to_numbered">تحويل W/M/F إلى W1/M1/F1 + تصحيح H2 إلى H1</option>
          <option value="all_to_plain">تحويل W1/M1/F1 إلى W/M/F + تصحيح H2 إلى H1</option>
          <option value="h2_to_h1_only">تصحيح H2 إلى H1 فقط</option>
        </select>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
          disabled={isRunning || totalCount === 0}
          className="inline-flex h-10 w-56 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {isRunning ? "جاري التنفيذ بالخلفية..." : "تنفيذ تحويل نمط البطاقات"}
        </button>
      </div>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
        أمثلة: <strong>WAB2025123W</strong> ⇄ <strong>WAB2025123W1</strong>،
        <strong> WAB2025123M</strong> ⇄ <strong>WAB2025123M1</strong>،
        <strong> WAB2025123F</strong> ⇄ <strong>WAB2025123F1</strong>،
        <strong> WAB2025123H</strong> → <strong>WAB2025123H1</strong> (يُحوَّل في all_to_numbered فقط)،
        <strong> WAB2025123H2</strong> ← غير صالح وسيُصحح إلى <strong>WAB2025123H1</strong>.
      </p>

      <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        ماذا يفعل كل خيار:
        {" "}<strong>all_to_numbered</strong> يحول W/M/F/H إلى W1/M1/F1/H1 ويصحح H2 إلى H1،
        {" "}<strong>all_to_plain</strong> يحول W1/M1/F1 إلى W/M/F ويصحح H2 إلى H1 (H بدون رقم لا يتغير)،
        {" "}<strong>h2_to_h1_only</strong> يصحح H2 إلى H1 دون تغيير W/M/F/H.
      </p>

      {(isRunning || statusMessage) && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
            <span className="font-bold">الحالة: {stateLabel}</span>
            <span>التقدم: {Math.max(0, Math.min(100, progress))}%</span>
            {totalCountInJob > 0 && <span>المعالج: {processedCount.toLocaleString("ar-LY")} / {totalCountInJob.toLocaleString("ar-LY")}</span>}
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {elapsedSeconds} ث</span>
            {jobId && <span>المهمة: {jobId}</span>}
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
            />
          </div>
          {statusMessage && <p className="mt-2 text-slate-600 dark:text-slate-400">{statusMessage}</p>}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </p>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isRunning && setConfirmOpen(false)}
        onConfirm={runFix}
        title="تأكيد تحويل نمط بطاقات الأب/الأم"
        description={`سيتم تنفيذ: ${MODE_LABELS[mode]}. هذا الإجراء يعدل رقم البطاقة مباشرة ويُسجل في سجل التدقيق.`}
        confirmLabel="نعم، نفذ التحويل"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isRunning}
        error={null}
      />
    </div>
  );
}
