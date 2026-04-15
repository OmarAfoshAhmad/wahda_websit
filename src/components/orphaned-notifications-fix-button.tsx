"use client";

import { useState, useTransition } from "react";
import { Loader2, Wrench } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { runDataHygieneSweepAction } from "@/app/actions/data-hygiene";

export function OrphanedNotificationsFixButton() {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixedCount, setFixedCount] = useState<number | null>(null);

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await runDataHygieneSweepAction({ mode: "orphaned_notifications", dryRun: false });
      if (!res.success) {
        setError(res.error ?? "تعذر تنفيذ المعالجة");
        return;
      }
      setConfirmOpen(false);
      setFixedCount(res.orphaned_notifications);
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

      {fixedCount !== null && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
          تمت المعالجة: {fixedCount.toLocaleString("ar-LY")} إشعار يتيم.
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
