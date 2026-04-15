"use client";

import { useState } from "react";
import { Ban, RotateCcw, Link2Off } from "lucide-react";
import { useRouter } from "next/navigation";
import { cancelTransaction } from "@/app/actions/cancel-transaction";
import { deleteCancellationTransaction, deleteCancellationPair } from "@/app/actions/restore-transaction";
import { ConfirmationModal } from "@/components/confirmation-modal";

interface TransactionCancelButtonProps {
  transactionId: string;
  isCancelled: boolean;
  type: string;
  canDeletePair?: boolean;
}

export function TransactionCancelButton({ transactionId, isCancelled, type, canDeletePair = false }: TransactionCancelButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (isCancelled) {
    return <span className="text-xs text-slate-400 font-medium">ملغاة</span>;
  }

  const isRestoreAction = type === "CANCELLATION"; // If it's a cancellation tx, we "restore" the original.

  const handleAction = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (isRestoreAction) {
        // Restore/Undo cancellation
        const result = await deleteCancellationTransaction(transactionId);
        if (result.success) {
          router.refresh();
          setIsModalOpen(false);
        } else {
          setError(result.error || "فشل التراجع عن الإلغاء");
        }
      } else {
        // Cancel transaction
        const result = await cancelTransaction(transactionId);
        if (result.success) {
          setIsModalOpen(false);
          router.refresh();
        } else {
          setError(result.error || "فشل إلغاء الحركة");
        }
      }
    } catch {
      setError("حدث خطأ غير متوقع. حاول مرة أخرى.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { setIsModalOpen(true); setError(null); }}
          disabled={isLoading}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:opacity-50 ${
            isRestoreAction
              ? "border-slate-300 text-slate-700 hover:bg-slate-50"
              : "border-red-300 text-red-700 hover:bg-red-50"
          }`}
          title={isRestoreAction ? "إعادة الخصم (إلغاء حركة التصحيح)" : "إلغاء الحركة (استرجاع المبلغ)"}
          aria-label={isRestoreAction ? "إعادة الخصم" : "إلغاء الحركة"}
        >
          {isRestoreAction ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
        </button>

        {isRestoreAction && canDeletePair && (
          <button
            type="button"
            onClick={() => { setPairModalOpen(true); setError(null); }}
            disabled={isLoading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-300 text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            title="حذف زوج الإلغاء والتصحيح نهائياً"
            aria-label="حذف زوج الإلغاء والتصحيح"
          >
            <Link2Off className="h-4 w-4" />
          </button>
        )}
      </div>

      {isModalOpen && (
        <ConfirmationModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onConfirm={handleAction}
          isLoading={isLoading}
          error={error}
          title={isRestoreAction ? "حذف حركة التراجع" : "إلغاء الحركة"}
          description={
            isRestoreAction 
              ? "هل أنت متأكد من حذف حركة التراجع هذه؟ سيؤدي ذلك إلى إعادة خصم المبلغ من رصيد المستفيد وتفعيل الحركة الأصلية مرة أخرى."
              : "هل أنت متأكد من إلغاء هذه الحركة؟ سيتم استرجاع المبلغ إلى رصيد المستفيد وإلغاء صلاحية هذه الحركة."
          }
          confirmLabel={isRestoreAction ? "حذف وإعادة الخصم" : "نعم، إلغاء الحركة"}
          variant="danger"
        />
      )}

      <ConfirmationModal
        isOpen={pairModalOpen}
        onClose={() => setPairModalOpen(false)}
        onConfirm={async () => {
          setIsLoading(true);
          const result = await deleteCancellationPair(transactionId);
          if (!result.success) {
            setError(result.error || "تعذر حذف الزوج");
          } else {
            setPairModalOpen(false);
            router.refresh();
          }
          setIsLoading(false);
        }}
        isLoading={isLoading}
        error={error}
        title="حذف زوج الإلغاء والتصحيح"
        description="سيتم حذف الحركة الأصلية الملغاة وحركة التصحيح المرتبطة بها نهائياً مع إعادة احتساب الرصيد تلقائياً. هذا الإجراء لا يمكن التراجع عنه."
        confirmLabel="نعم، حذف الزوج"
        variant="danger"
      />
    </>
  );
}
