"use client";

import { useState, useTransition, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { bulkTransactionSelectionAction } from "@/app/actions/cancel-transaction";
import { ConfirmationModal } from "@/components/confirmation-modal";
import { useToast } from "@/components/toast";

type Props = {
  formId: string;
  op: "cancel_or_rededuct" | "soft_delete" | "permanent_delete" | "restore_delete";
  label: string;
  variant?: "danger" | "warning" | "info" | "success";
};

export function TransactionsBulkActionButton({ formId, op, label, variant = "danger" }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toast = useToast();

  const setPageFeedback = (message: string, type: "error" | "success") => {
    const params = new URLSearchParams(searchParams.toString());
    if (type === "success") {
      params.delete("bulk_msg");
      params.delete("bulk_type");
      toast.success(message);
    } else {
      params.set("bulk_msg", message);
      params.set("bulk_type", type);
    }
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

    const count = checked.length;
    let nextConfirmText = "";
    if (op === "cancel_or_rededuct") {
      nextConfirmText = `هل أنت متأكد من إلغاء ${count} حركة محددة؟ سيتم استرجاع المبالغ إلى أرصدة المستفيدين وتعديل استهلاكاتهم.`;
    } else if (op === "permanent_delete") {
      nextConfirmText = `هل أنت متأكد من حذف ${count} حركة محددة نهائياً من قاعدة البيانات؟ سيتم إعادة احتساب أرصدة المستفيدين تلقائياً. هذا الإجراء لا يمكن التراجع عنه!`;
    } else if (op === "soft_delete") {
      nextConfirmText = `هل أنت متأكد من حذف ${count} حركة محددة حذفاً ناعماً؟`;
    } else {
      nextConfirmText = `هل أنت متأكد من استعادة ${count} حركة محددة؟`;
    }

    setSelectedIds(checked.map((input) => input.value));
    setConfirmText(nextConfirmText);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (selectedIds.length === 0) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("op", op);
      selectedIds.forEach((id) => formData.append("ids", id));

      const result = await bulkTransactionSelectionAction(formData);

      if (result?.error) {
        setConfirmOpen(false);
        setPageFeedback(result.error, "error");
        return;
      }

      setConfirmOpen(false);
      setPageFeedback("تم تنفيذ العملية بنجاح على الحركات المحددة!", "success");
      
      // Uncheck all checkboxes on success
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (form) {
        const checkboxes = form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked');
        checkboxes.forEach((cb) => {
          cb.checked = false;
        });
        const event = new Event("change", { bubbles: true });
        form.dispatchEvent(event);
      }
      
      router.refresh();
    });
  };

  // Button styles based on variant and op
  let btnClasses = "inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-black transition-colors disabled:opacity-60 ";
  if (variant === "danger") {
    btnClasses += "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400 dark:hover:bg-red-950/40";
  } else if (variant === "warning") {
    btnClasses += "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400 dark:hover:bg-amber-950/40";
  } else if (variant === "success") {
    btnClasses += "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-400 dark:hover:bg-emerald-950/40";
  } else {
    btnClasses += "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={btnClasses}
      >
        {isPending ? "جارٍ التنفيذ..." : label}
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
        confirmLabel="تأكيد ومتابعة"
        variant={variant === "success" ? "info" : "danger"}
        isLoading={isPending}
      />
    </>
  );
}

export function SelectAllTransactionsCheckbox({ formId }: { formId: string }) {
  const [isChecked, setIsChecked] = useState(false);

  useEffect(() => {
    const updateState = () => {
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (!form) return;
      const allEnabled = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="ids"]:not(:disabled)'));
      const allChecked = allEnabled.length > 0 && allEnabled.every(cb => cb.checked);
      setIsChecked(allChecked);
    };

    updateState();

    const form = document.getElementById(formId);
    if (!form) return;

    form.addEventListener("change", updateState);
    
    const observer = new MutationObserver(() => updateState());
    observer.observe(form, { childList: true, subtree: true });

    return () => {
      form.removeEventListener("change", updateState);
      observer.disconnect();
    };
  }, [formId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setIsChecked(checked);
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const checkboxes = form.querySelectorAll<HTMLInputElement>('input[name="ids"]:not(:disabled)');
    checkboxes.forEach((cb) => {
      cb.checked = checked;
    });
    const event = new Event("change", { bubbles: true });
    form.dispatchEvent(event);
  };

  return (
    <input
      type="checkbox"
      checked={isChecked}
      onChange={handleChange}
      title="تحديد الكل"
      className="h-4 w-4 rounded border-slate-350 dark:border-slate-700 text-teal-650 focus:ring-teal-500/30"
    />
  );
}
