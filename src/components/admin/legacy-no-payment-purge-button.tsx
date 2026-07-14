"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Loader2, Trash2 } from "lucide-react";
import { getMaintenanceJobAction, startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";

const ACTIVE_LEGACY_PURGE_JOB_KEY = "active_legacy_purge_no_payment_job";

type Props = {
  candidateCount: number;
};

export function LegacyNoPaymentPurgeButton({ candidateCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<"queued" | "running" | "succeeded" | "failed" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    const stored = window.localStorage.getItem(ACTIVE_LEGACY_PURGE_JOB_KEY);
    if (stored) {
      setJobId(stored);
      setMessage(`تم استئناف متابعة مهمة تصفية البطاقات القديمة ${stored}.`);
      setProgress(8);
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    const tick = async () => {
      const status = await getMaintenanceJobAction(jobId);
      if (cancelled) return;

      if (!status.success || !status.job) {
        setError(status.error ?? "تعذر جلب حالة مهمة تصفية البطاقات القديمة.");
        return;
      }

      const job = status.job;
      setJobState(job.state);

      const base = new Date(job.startedAt ?? job.createdAt).getTime();
      const now = Date.now();
      const seconds = Math.max(0, Math.floor((now - base) / 1000));
      setElapsedSeconds(seconds);

      if (job.state === "queued") {
        setProgress((p) => Math.max(10, Math.min(20, p + 2)));
        setMessage(`المهمة ${job.id} في قائمة الانتظار...`);
        return;
      }

      if (job.state === "running") {
        setProgress((p) => Math.max(22, Math.min(95, p + 4)));
        setMessage(`المهمة ${job.id} قيد التنفيذ بالخلفية.`);
        return;
      }

      if (job.state === "succeeded") {
        setProgress(100);
        setMessage(job.summary ?? `اكتملت المهمة ${job.id} بنجاح.`);
        window.localStorage.removeItem(ACTIVE_LEGACY_PURGE_JOB_KEY);
        setJobId(null);
        router.refresh();
        return;
      }

      setProgress(100);
      setError(job.error ?? `فشلت المهمة ${job.id}.`);
      setMessage(`فشلت المهمة ${job.id}.`);
      window.localStorage.removeItem(ACTIVE_LEGACY_PURGE_JOB_KEY);
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

  const onClick = () => {
    if (candidateCount <= 0) return;

    const confirmed = window.confirm(
      `سيتم حذف ${candidateCount.toLocaleString("ar-LY")} بطاقة موسومة كقديمة وليس لها دفعة، مع نقل حركاتهم لأفراد عائلاتهم. هذه العملية لا يمكن التراجع عنها بسهولة. هل تريد المتابعة؟`
    );
    if (!confirmed) return;

    if (jobId || isPending) return;

    setMessage(null);
    setError(null);

    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "purge_legacy_no_payment" });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء المعالجة بالخلفية.");
        return;
      }

      setJobId(queued.job.id);
      setJobState("queued");
      setProgress(10);
      setElapsedSeconds(0);
      setMessage(`تم بدء المعالجة بالخلفية (رقم المهمة: ${queued.job.id}).`);
      window.localStorage.setItem(ACTIVE_LEGACY_PURGE_JOB_KEY, queued.job.id);
    });
  };

  const isRunning = Boolean(jobId) || isPending;
  const stateLabel = useMemo(() => {
    if (jobState === "queued") return "في الانتظار";
    if (jobState === "running") return "جارية";
    if (jobState === "succeeded") return "اكتملت";
    if (jobState === "failed") return "فشلت";
    return "جاهزة";
  }, [jobState]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={isRunning || candidateCount <= 0}
        className="inline-flex h-9 items-center justify-center rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-slate-800 px-3 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRunning ? (
          <>
            <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />
            جاري التصفية...
          </>
        ) : (
          <>
            <Trash2 className="ml-1 h-3.5 w-3.5" />
            تصفية القديمة بدون دفعة (حذف + ترحيل)
          </>
        )}
      </button>

      {(isRunning || message) && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
            <span className="font-bold">الحالة: {stateLabel}</span>
            <span>التقدم: {Math.max(0, Math.min(100, progress))}%</span>
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {elapsedSeconds} ث</span>
            {jobId && <span>المهمة: {jobId}</span>}
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-red-500 transition-all duration-500"
              style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
            />
          </div>
          {message && <p className="mt-2 text-slate-600 dark:text-slate-400">{message}</p>}
        </div>
      )}

      {error ? <span className="text-xs font-bold text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}
