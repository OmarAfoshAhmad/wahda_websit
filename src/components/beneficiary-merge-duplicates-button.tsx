"use client";

import { useState, useTransition } from "react";
import { GitMerge, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { mergeDuplicateBeneficiaries } from "@/app/actions/beneficiary";
import { ConfirmationModal } from "@/components/confirmation-modal";

export function BeneficiaryMergeDuplicatesButton({
  beneficiaryId,
  beneficiaryName: _beneficiaryName,
  cardNumber,
}: {
  beneficiaryId: string;
  beneficiaryName: string;
  cardNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onConfirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await mergeDuplicateBeneficiaries(beneficiaryId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-100"
        title="دمج السجلات المكررة بنفس رقم البطاقة"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
        دمج المكرر
      </button>

      <ConfirmationModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={onConfirm}
        isLoading={isPending}
        error={error}
        title="تأكيد دمج المكرر"
        description={`سيتم دمج السجلات المكررة لنفس البطاقة (${cardNumber}) ونقل الحركات والإشعارات إلى سجل أساسي واحد. عند وجود اختلاف بسبب الأصفار بعد 2025 سيتم الإبقاء تلقائياً على البطاقة التي تحتوي الأصفار ثم حذف البقية حذفًا ناعمًا. هل تريد المتابعة؟`}
        confirmLabel="نعم، دمج الآن"
        variant="warning"
      />
    </>
  );
}
