"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { getMaintenanceJobAction, startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";
import { useRouter } from "next/navigation";

type Props = {
  totalFamilies: number;
  visibleFamilies: number;
};

export function NormalizeImportIntegerDistributionButton({ totalFamilies, visibleFamilies }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const timer = setInterval(async () => {
      const status = await getMaintenanceJobAction(jobId);
      if (!status.success || !status.job) {
        return;
      }

      if (status.job.state === "queued" || status.job.state === "running") {
        setStatusMessage(`المهمة ${jobId} قيد التنفيذ بالخلفية (${status.job.state === "queued" ? "في الانتظار" : "جارية"}).`);
        return;
      }

      if (status.job.state === "succeeded") {
        setStatusMessage(`اكتملت المهمة ${jobId} بنجاح. ${status.job.summary ?? ""}`.trim());
        setJobId(null);
        router.refresh();
        return;
      }

      if (status.job.state === "failed") {
        setError(status.job.error ?? "فشلت المهمة بالخلفية");
        setStatusMessage(`فشلت المهمة ${jobId}.`);
        setJobId(null);
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [jobId, router]);

  const runFix = () => {
    setError(null);
    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "normalize_import_integer_distribution" });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء المعالجة بالخلفية");
        return;
      }
      setStatusMessage(`تم بدء معالجة التوزيع بالخلفية (رقم المهمة: ${queued.job.id}).`);
      setJobId(queued.job.id);
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
