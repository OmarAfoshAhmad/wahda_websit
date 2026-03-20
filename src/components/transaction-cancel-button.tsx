"use client";

import { useState } from "react";
import { Trash2, RotateCcw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cancelTransaction } from "@/app/actions/cancel-transaction";
import { deleteCancellationTransaction } from "@/app/actions/restore-transaction";
import { ConfirmationModal } from "@/components/confirmation-modal";

interface TransactionCancelButtonProps {
  transactionId: string;
  isCancelled: boolean;
  type: string;
}

export function TransactionCancelButton({ transactionId, isCancelled, type }: TransactionCancelButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();

  if (isCancelled) {
    return <span className="text-xs text-slate-400 font-medium">ملغاة</span>;
  }

  const isRestoreAction = type === "CANCELLATION"; // If it's a cancellation tx, we "restore" the original.

  const handleAction = async () => {
    setIsLoading(true);
    try {
      if (isRestoreAction) {
        // Restore/Undo cancellation
        const result = await deleteCancellationTransaction(transactionId);
        if (result.success) {
          router.refresh();
          setIsModalOpen(false);
        } else {
          alert(result.error || "فشل التراجع عن الإلغاء");
        }
      } else {
        // Cancel transaction
        const result = await cancelTransaction(transactionId);
        if (result.success) {
          router.refresh();
          setIsModalOpen(false);
        } else {
          alert(result.error || "فشل إلغاء الحركة");
        }
      }
    } catch (error) {
      console.error(error);
      alert("حدث خطأ غير متوقع");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        disabled={isLoading}
        className={`p-1 rounded-md transition-colors disabled:opacity-50 ${
          isRestoreAction 
            ? "text-slate-500 hover:bg-slate-100" 
            : "text-red-600 hover:bg-red-50"
        }`}
        title={isRestoreAction ? "حذف حركة التراجع (إعادة الخصم)" : "إلغاء الحركة (استرجاع المبلغ)"}
      >
        {isRestoreAction ? <Trash2 className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
      </button>

      {isModalOpen && (
        <ConfirmationModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onConfirm={handleAction}
          isLoading={isLoading}
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
    </>
  );
}
