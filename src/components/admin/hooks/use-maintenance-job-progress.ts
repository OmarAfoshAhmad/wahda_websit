"use client";

import { useEffect, useRef, useState } from "react";
import { getMaintenanceJobAction, type MaintenanceJobState } from "@/app/actions/maintenance-jobs";

type CompletionPayload = {
  success: boolean;
  summary?: string;
  error?: string;
};

export function useMaintenanceJobProgress(
  jobId: string | null,
  onComplete?: (payload: CompletionPayload) => void,
) {
  const [jobState, setJobState] = useState<MaintenanceJobState | null>(null);
  const [progress, setProgress] = useState(0);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completedRef = useRef<string | null>(null);
  const onCompleteRef = useRef<typeof onComplete>(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!jobId) {
      setJobState(null);
      setProgress(0);
      setCurrent(0);
      setTotal(0);
      setElapsedSeconds(0);
      return;
    }

    let cancelled = false;
    completedRef.current = null;

    const tick = async () => {
      const status = await getMaintenanceJobAction(jobId);
      if (cancelled) return;

      if (!status.success || !status.job) {
        const err = status.error ?? "تعذر جلب حالة المهمة";
        setError(err);
        if (completedRef.current !== jobId) {
          completedRef.current = jobId;
          onCompleteRef.current?.({ success: false, error: err });
        }
        return;
      }

      const job = status.job;
      setJobState(job.state);

      const base = new Date(job.startedAt ?? job.createdAt).getTime();
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - base) / 1000)));

      if (job.progress) {
        setCurrent(Math.max(0, Number(job.progress.current) || 0));
        setTotal(Math.max(0, Number(job.progress.total) || 0));
        setProgress(Math.max(0, Math.min(100, Number(job.progress.percent) || 0)));
      }

      if (job.state === "queued") {
        setMessage(`المهمة ${job.id} في قائمة الانتظار...`);
        return;
      }

      if (job.state === "running") {
        setMessage(job.progress?.message ?? `المهمة ${job.id} قيد التنفيذ بالخلفية.`);
        return;
      }

      if (completedRef.current === jobId) {
        return;
      }
      completedRef.current = jobId;

      if (job.state === "succeeded") {
        setProgress(100);
        const summary = job.summary ?? `اكتملت المهمة ${job.id} بنجاح.`;
        setMessage(summary);
        onCompleteRef.current?.({ success: true, summary });
        return;
      }

      const err = job.error ?? `فشلت المهمة ${job.id}.`;
      setError(err);
      setMessage(`فشلت المهمة ${job.id}.`);
      onCompleteRef.current?.({ success: false, error: err });
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId]);

  const isRunning = jobState === "queued" || jobState === "running";

  return {
    jobState,
    progress,
    current,
    total,
    elapsedSeconds,
    message,
    error,
    isRunning,
  };
}
