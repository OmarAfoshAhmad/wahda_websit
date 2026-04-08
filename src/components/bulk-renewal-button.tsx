"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { bulkRenewBalance } from "@/app/actions/beneficiary";
import { ConfirmationModal } from "@/components/confirmation-modal";

type Props = {
  formId: string;
};

export function BulkRenewalButton({ formId }: Props) {
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
      setFeedbackType("error");
      setFeedback("يرجى تحديد عنصر واحد على الأقل");
      return;
    }

    setSelectedIds(checked.map((input) => input.value));
    setConfirmText(`سيتم تجديد الرصيد لـ ${checked.length} مستفيد وإعادة حالتهم إلى نشط. هل تريد المتابعة؟`);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    if (selectedIds.length === 0) return;

    startTransition(async () => {
      const formData = new FormData();
      selectedIds.forEach((id) => formData.append("ids", id));

      const result = await bulkRenewBalance(formData);

      if (result?.error) {
        setFeedbackType("error");
        setFeedback(result.error);
        return;
      }

      setFeedbackType("success");
      setFeedback(`تم تجديد الرصيد بنجاح لـ ${result?.renewedCount ?? 0} مستفيد`);
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
        className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-black text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
      >
        {isPending ? "جارٍ التنفيذ..." : "تجديد رصيد المحدد"}
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
        title="تأكيد تجديد الرصيد"
        description={confirmText}
        confirmLabel="نعم، تجديد"
        variant="info"
        isLoading={isPending}
      />
    </>
  );
}
