"use client";

import { useState, useTransition } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  bulkDeleteBeneficiaries,
  bulkPermanentDeleteBeneficiaries,
} from "@/app/actions/beneficiary";
import { ConfirmationModal } from "@/components/confirmation-modal";

type Props = {
  formId: string;
  mode: "soft" | "permanent";
};

export function BeneficiariesBulkActionButton({ formId, mode }: Props) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"error" | "success">("success");
  const router = useRouter();

  useEffect(() => {
    const collect = () => {
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (!form) return;
      const checked = form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked');
      setSelectedCount(checked.length);
    };

    collect();
    document.addEventListener("change", collect);
    return () => document.removeEventListener("change", collect);
  }, [formId]);

  const handleClick = () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    const checked = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')
    );

    if (checked.length === 0) {
      setFeedbackType("error");
      setFeedback("يرجى تحديد عنصر واحد على الأقل");
      return;
    }

    const selectedCount = checked.length;
    const nextConfirmText =
      mode === "soft"
        ? `سيتم حذف ${selectedCount} مستفيد (حذف ناعم). هل تريد المتابعة؟`
        : `سيتم حذف ${selectedCount} مستفيد نهائياً من المحذوفات. هذا الإجراء غير قابل للتراجع. هل تريد المتابعة؟`;

    setSelectedIds(checked.map((input) => input.value));
    setConfirmText(nextConfirmText);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (selectedIds.length === 0) return;

    startTransition(async () => {
      const formData = new FormData();
      selectedIds.forEach((id) => formData.append("ids", id));

      const result =
        mode === "soft"
          ? await bulkDeleteBeneficiaries(formData)
          : await bulkPermanentDeleteBeneficiaries(formData);

      if (result?.error) {
        setFeedbackType("error");
        setFeedback(result.error);
        return;
      }

      setFeedbackType("success");
      setFeedback(`تم التنفيذ بنجاح. المحذوف: ${result?.deletedCount ?? 0} - غير المنفذ: ${result?.skippedCount ?? 0}`);
      setConfirmOpen(false);
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
            ? "inline-flex h-8 items-center justify-center rounded-md border border-red-300 bg-red-50 px-3 text-xs font-black text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
            : "inline-flex h-8 items-center justify-center rounded-md border border-red-400 bg-red-100 px-3 text-xs font-black text-red-800 transition-colors hover:bg-red-200 disabled:opacity-60"
        }
      >
        {isPending
          ? "جارٍ التنفيذ..."
          : mode === "soft"
          ? "حذف المحدد"
          : "حذف نهائي للمحدد"}
        <span className="mr-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/80 px-1 text-[10px] font-black text-slate-700">
          {selectedCount}
        </span>
      </button>

      {feedback && (
        <div className={`mt-2 rounded-md px-3 py-2 text-xs font-bold ${feedbackType === "error" ? "border border-red-200 bg-red-50 text-red-700" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {feedback}
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="تأكيد العملية"
        description={confirmText}
        confirmLabel={mode === "soft" ? "نعم، حذف" : "نعم، حذف نهائي"}
        variant="danger"
        isLoading={isPending}
      />
    </>
  );
}
