"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { Loader2 } from "lucide-react";

type MergeBatchResponse = {
  error?: string;
  mergedGroups?: number;
  mergedRows?: number;
  truncatedCount?: number;
  firstAuditId?: string | null;
};

export function AutoMergeAllZeroVariantsButton() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({
    mergedGroups: 0,
    mergedRows: 0,
    remainingGroups: 0,
    batches: 0,
  });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setQueryFeedback = (type: "ok" | "err", message: string, auditId?: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "review");
    params.delete("ok");
    params.delete("err");
    params.delete("audit");
    params.set(type, message);
    if (auditId) params.set("audit", auditId);
    router.replace(`${pathname}?${params.toString()}`);
    router.refresh();
  };

  const handleAutoMerge = async () => {
    if (running) return;

    setRunning(true);
    setProgress({ mergedGroups: 0, mergedRows: 0, remainingGroups: 0, batches: 0 });
    try {
      let totalMergedGroups = 0;
      let totalMergedRows = 0;
      let remainingGroups = 0;
      let firstAuditId: string | null = null;

      // حد أمان لمنع دوران لا نهائي عند أي حالة غير متوقعة
      for (let iteration = 0; iteration < 300; iteration += 1) {
        const response = await fetch("/api/admin/duplicates/merge-all-safe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        const data = (await response.json().catch(() => null)) as MergeBatchResponse | null;
        if (!response.ok || !data) {
          throw new Error(data?.error ?? "تعذر تنفيذ الدمج الآمن");
        }

        if (data.error) {
          throw new Error(data.error);
        }

        totalMergedGroups += Number(data.mergedGroups ?? 0);
        totalMergedRows += Number(data.mergedRows ?? 0);
        remainingGroups = Number(data.truncatedCount ?? 0);
        setProgress((prev) => ({
          mergedGroups: totalMergedGroups,
          mergedRows: totalMergedRows,
          remainingGroups,
          batches: prev.batches + 1,
        }));
        if (!firstAuditId && data.firstAuditId) {
          firstAuditId = data.firstAuditId;
        }

        // إذا لا يوجد متبقٍ ننهي فوراً
        if (remainingGroups <= 0) {
          break;
        }

        // إذا لم يتحرك الدمج في هذه الدورة مع بقاء مجموعات، نتوقف لتجنب دوران غير مفيد
        if (Number(data.mergedGroups ?? 0) <= 0) {
          throw new Error("توقفت المعالجة لأن بعض المجموعات تحتاج مراجعة يدوية.");
        }
      }

      const msg = `تم الدمج الآمن بشكل متتالي: ${totalMergedGroups} مجموعة (${totalMergedRows} سجلات)${remainingGroups > 0 ? `، والمتبقي ${remainingGroups} مجموعة` : ""}`;
      setQueryFeedback("ok", msg, firstAuditId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "تعذر تنفيذ الدمج الآمن المتتالي";
      setQueryFeedback("err", msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-w-60 space-y-2">
      <Button
        type="button"
        onClick={handleAutoMerge}
        disabled={running}
        className="h-9 w-full text-xs flex items-center justify-center gap-2"
      >
        {running && <Loader2 className="h-3 w-3 animate-spin" />}
        {running ? "جاري الدمج المتتالي..." : "دمج آمن لجميع التكرارات"}
      </Button>

      {running && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] font-bold text-sky-800 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-300">
          <p>
            تم دمج {progress.mergedGroups} مجموعة ({progress.mergedRows} سجلات){progress.remainingGroups > 0 ? ` • المتبقي تقريباً ${progress.remainingGroups}` : ""}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-sky-200/70 dark:bg-sky-900/60">
            <div
              className="h-full bg-sky-600 transition-all"
              style={{
                width: `${Math.max(5, Math.min(100, Math.round((progress.mergedGroups / Math.max(1, progress.mergedGroups + progress.remainingGroups)) * 100)))}%`,
              }}
            />
          </div>
          <p className="mt-1 opacity-80">دفعات منفذة: {progress.batches}</p>
        </div>
      )}
    </div>
  );
}
