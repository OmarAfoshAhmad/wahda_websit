"use client";

import { useState, useTransition } from "react";
import { Loader2, Wrench } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { startMaintenanceJobAction } from "@/app/actions/maintenance-jobs";

export function OrphanedNotificationsFixButton() {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const queued = await startMaintenanceJobAction({ kind: "data_hygiene_sweep", mode: "orphaned_notifications" });
      if (!queued.success || !queued.job) {
        setError(queued.error ?? "تعذر بدء المعالجة بالخلفية");
        return;
      }
      setConfirmOpen(false);
      setStatusMessage(`تم بدء المعالجة بالخلفية (رقم المهمة: ${queued.job.id}). يمكنك تحديث الصفحة لاحقًا لمراجعة النتائج.`);
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={isPending}
        className="inline-flex h-10 w-56 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#0f2a4a] px-4 text-sm font-black text-white transition-colors hover:bg-[#0b1f38] disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
        معالجة الإشعارات اليتيمة
      </button>

      {statusMessage && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400">
          {statusMessage}
        </p>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => !isPending && setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="تأكيد معالجة الإشعارات اليتيمة"
        description="سيتم حذف الإشعارات المرتبطة بمستفيدين محذوفين."
        confirmLabel="نعم، نفذ المعالجة"
        cancelLabel="إلغاء"
        variant="warning"
        isLoading={isPending}
        error={error}
      />
    </div>
  );
}
