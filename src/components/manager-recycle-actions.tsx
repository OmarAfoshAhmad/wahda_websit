"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { restoreManager, permanentlyDeleteManager } from "@/app/actions/manager";

type Props = {
  id: string;
  name: string;
  transactionCount: number;
};

export function ManagerRecycleActions({ id, name, transactionCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<"restore" | "permanent" | null>(null);

  const handleRestore = () => {
    setError(null);
    startTransition(async () => {
      const res = await restoreManager(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setConfirmMode(null);
      router.refresh();
    });
  };

  const handlePermanentDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await permanentlyDeleteManager(id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setConfirmMode(null);
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirmMode("restore");
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100"
          title="استعادة"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirmMode("permanent");
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 transition-colors hover:bg-red-100"
          title="حذف نهائي"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <ConfirmationModal
        isOpen={confirmMode === "restore"}
        onClose={() => !isPending && setConfirmMode(null)}
        onConfirm={handleRestore}
        title="تأكيد الاستعادة"
        description={`سيتم استعادة الحساب ${name} وإعادته للحسابات النشطة.`}
        confirmLabel="استعادة"
        cancelLabel="إلغاء"
        variant="info"
        isLoading={isPending}
        error={error}
      />

      <ConfirmationModal
        isOpen={confirmMode === "permanent"}
        onClose={() => !isPending && setConfirmMode(null)}
        onConfirm={handlePermanentDelete}
        title="تأكيد الحذف النهائي"
        description={`سيتم حذف الحساب ${name} نهائيا. لا يمكن الحذف النهائي إذا كان للحساب معاملات (${transactionCount}).`}
        confirmLabel="حذف نهائي"
        cancelLabel="إلغاء"
        variant="danger"
        isLoading={isPending}
        error={error}
      />
    </>
  );
}
