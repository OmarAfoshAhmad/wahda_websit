"use client";

import { useState, useTransition } from "react";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { bulkTransactionSelectionAction } from "@/app/actions/cancel-transaction";
import { ConfirmationModal } from "@/components/confirmation-modal";

type Props = {
  formId: string;
  mode: "soft" | "permanent" | "restore";
};

export function TransactionsBulkActionButton({ formId, mode }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setPageFeedback = (message: string, type: "error" | "success") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("bulk_msg", message);
    params.set("bulk_type", type);
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const collect = () => {
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (!form) return;
      const checked = form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked');
      setSelectedCount(checked.length);
    };

    collect();

    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("change", collect);
    return () => form.removeEventListener("change", collect);
  }, [formId]);

  const handleClick = () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    const checked = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')
    );

    if (checked.length === 0) {
      setPageFeedback("يرجى تحديد حركة واحدة على الأقل", "error");
      return;
    }

    const selectedCount = checked.length;
    const nextConfirmText =
      mode === "soft"
        ? `سيتم إلغاء (حذف ناعم) لـ ${selectedCount} حركة مالية مع إعادة المبالغ لأرصدة المستفيدين. هل تريد المتابعة؟`
        : mode === "restore"
        ? `سيتم استعادة ${selectedCount} حركة ملغاة وإعادة خصم مبالغها من أرصدة المستفيدين. هل تريد المتابعة؟`
        : `سيتم حذف ${selectedCount} حركة ملغاة نهائياً من قاعدة البيانات. هذا الإجراء غير قابل للتراجع. هل تريد المتابعة؟`;

    setSelectedIds(checked.map((input) => input.value));
    setConfirmText(nextConfirmText);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (selectedIds.length === 0) return;

    startTransition(async () => {
      const formData = new FormData();
      selectedIds.forEach((id) => formData.append("ids", id));
      
      const op = mode === "soft" ? "soft_delete" : mode === "restore" ? "restore_delete" : "permanent_delete";
      formData.append("op", op);

      const result = await bulkTransactionSelectionAction(formData);

      if (result?.error) {
        setPageFeedback(result.error, "error");
        return;
      }

      setConfirmOpen(false);
      setPageFeedback("تم تنفيذ العملية الجماعية بنجاح", "success");
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={
          mode === "soft"
            ? "inline-flex h-8 items-center justify-center rounded-md border border-red-300 bg-red-50 px-3 text-xs font-black text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40"
            : mode === "restore"
            ? "inline-flex h-8 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-black text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            : "inline-flex h-8 items-center justify-center rounded-md border border-red-400 bg-red-100 px-3 text-xs font-black text-red-800 transition-colors hover:bg-red-200 disabled:opacity-60 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
        }
      >
        {isPending
          ? "جارٍ التنفيذ..."
          : mode === "soft"
          ? "إلغاء الحركات المحددة"
          : mode === "restore"
          ? "استعادة الحركات المحددة"
          : "حذف نهائي للمحدد"}
        <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/80 px-1 text-[10px] font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {selectedCount}
        </span>
      </button>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="تأكيد العملية الجماعية"
        description={confirmText}
        confirmLabel={mode === "soft" ? "نعم، إلغاء الحركات" : mode === "restore" ? "نعم، استعادة" : "نعم، حذف نهائي"}
        variant={mode === "restore" ? "info" : "danger"}
        isLoading={isPending}
      />
    </>
  );
}
