"use client";

import { useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { restoreSingleTransaction, deleteSingleTransactionPermanently } from "@/app/actions/restore-transaction";
import { ConfirmationModal } from "@/components/confirmation-modal";

interface TransactionRestoreActionsProps {
  id: string;
  name: string;
}

export function TransactionRestoreActions({ id, name }: TransactionRestoreActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleRestore = () => {
    setError(null);
    startTransition(async () => {
      const res = await restoreSingleTransaction(id);
      if (res?.error) {
        setError(res.error);
      } else {
        setRestoreModalOpen(false);
        router.refresh();
      }
    });
  };

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteSingleTransactionPermanently(id);
      if (res?.error) {
        setError(res.error);
      } else {
        setDeleteModalOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setRestoreModalOpen(true);
          }}
          disabled={isPending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-450 dark:hover:bg-emerald-950/45"
          title="استعادة الحركة وإعادة الخصم"
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setDeleteModalOpen(true);
          }}
          disabled={isPending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40"
          title="حذف الحركة نهائياً من قاعدة البيانات"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <ConfirmationModal
        isOpen={restoreModalOpen}
        onClose={() => setRestoreModalOpen(false)}
        onConfirm={handleRestore}
        title="تأكيد استعادة الحركة"
        description={`هل أنت متأكد من استعادة الحركة المالية للمستفيد (${name})؟ سيتم إعادة خصم مبلغ الحركة من رصيده المتبقي.`}
        confirmLabel="نعم، استعادة الحركة"
        variant="info"
        isLoading={isPending}
        error={error}
      />

      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="تأكيد الحذف النهائي للحركة"
        description={`هل أنت متأكد من حذف هذه الحركة المالية للمستفيد (${name}) نهائياً من قاعدة البيانات؟ هذا الإجراء لا يمكن التراجع عنه.`}
        confirmLabel="نعم، حذف نهائي"
        variant="danger"
        isLoading={isPending}
        error={error}
      />
    </>
  );
}
