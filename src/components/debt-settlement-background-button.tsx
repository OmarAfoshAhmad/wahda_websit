"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, PlayCircle, Clock3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { getMaintenanceJobAction, startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";

const ACTIVE_DEBT_SETTLEMENT_JOB_KEY = "active_debt_settlement_job";

type Props = {
  totalCases: number;
};

export function DebtSettlementBackgroundButton({ totalCases }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<"queued" | "running" | "succeeded" | "failed" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  useEffect(() => {
    const stored = window.localStorage.getItem(ACTIVE_DEBT_SETTLEMENT_JOB_KEY);
    if (stored) {
      setJobId(stored);
      setStatusMessage(`تم استئناف متابعة المهمة ${stored} من المتصفح.`);
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
        setError(status.error ?? "تعذر جلب حالة مهمة تسوية المديونية.");
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
        setStatusMessage(`المهمة ${job.id} في قائمة الانتظار...`);
        return;
      }

      if (job.state === "running") {
        setProgress((p) => Math.max(22, Math.min(95, p + 4)));
        setStatusMessage(`المهمة ${job.id} قيد التنفيذ بالخلفية.`);
        return;
      }

      if (job.state === "succeeded") {
        setProgress(100);
        setStatusMessage(job.summary ?? `اكتملت المهمة ${job.id} بنجاح.`);
        window.localStorage.removeItem(ACTIVE_DEBT_SETTLEMENT_JOB_KEY);
        setJobId(null);
        router.refresh();
        return;
      }

      setProgress(100);
      setError(job.error ?? `فشلت المهمة ${job.id}.`);
      setStatusMessage(`فشلت المهمة ${job.id}.`);
      window.localStorage.removeItem(ACTIVE_DEBT_SETTLEMENT_JOB_KEY);
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

  const runSettlement = () => {
    setError(null);
    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "settle_overdrawn_debt" });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء التسوية بالخلفية.");
        return;
      }

      setJobId(queued.job.id);
      setJobState("queued");
      setProgress(10);
      setElapsedSeconds(0);
      setStatusMessage(`تم بدء تسوية المديونية بالخلفية (رقم المهمة: ${queued.job.id}).`);
      window.localStorage.setItem(ACTIVE_DEBT_SETTLEMENT_JOB_KEY, queued.job.id);
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
      <Button
        type="button"
        onClick={runSettlement}
        className="h-10 bg-red-600 hover:bg-red-700 text-white"
        disabled={isRunning || totalCases === 0}
      >
        {isRunning ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="mr-2">جاري تنفيذ التسوية بالخلفية...</span>
          </>
        ) : (
          <>
            <PlayCircle className="h-4 w-4" />
            <span className="mr-2">معالجة المديونية بالخلفية</span>
          </>
        )}
      </Button>

      {(isRunning || statusMessage) && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
            <span className="font-bold">الحالة: {stateLabel}</span>
            <span>التقدم: {Math.max(0, Math.min(100, progress))}%</span>
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
    </div>
  );
}
