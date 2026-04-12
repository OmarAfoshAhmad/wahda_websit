"use client";

import { useState, useTransition } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  bulkDeleteBeneficiaries,
  bulkPermanentDeleteBeneficiaries,
  bulkRestoreBeneficiaries,
} from "@/app/actions/beneficiary";
import { ConfirmationModal } from "@/components/confirmation-modal";

type Props = {
  formId: string;
  mode: "soft" | "permanent" | "restore";
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

    // FIX PERF-04: تقييد المستمع بالنموذج فقط بدلاً من document لتجنب الإطلاق على كل تغيير في الصفحة
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

    const selectedCount = checked.length;
    const nextConfirmText =
      mode === "soft"
        ? `سيتم حذف ${selectedCount} مستفيد (حذف ناعم). هل تريد المتابعة؟`
        : mode === "restore"
        ? `سيتم استعادة ${selectedCount} مستفيد من المحذوفات. هل تريد المتابعة؟`
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
          : mode === "restore"
          ? await bulkRestoreBeneficiaries(formData)
          : await bulkPermanentDeleteBeneficiaries(formData);

      if (result?.error) {
        setFeedbackType("error");
        setFeedback(result.error);
        return;
      }

      const skippedCount = "skippedCount" in result ? result.skippedCount : 0;
      const restoredCount = "restoredCount" in result ? result.restoredCount : 0;
      const deletedCount = "deletedCount" in result ? result.deletedCount : 0;

      setFeedbackType("success");
      if (mode === "restore") {
        setFeedback(`تم التنفيذ بنجاح. المستعاد: ${restoredCount} - غير المنفذ: ${skippedCount}`);
      } else {
        setFeedback(`تم التنفيذ بنجاح. المحذوف: ${deletedCount} - غير المنفذ: ${skippedCount}`);
      }
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
            : mode === "restore"
            ? "inline-flex h-8 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-black text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
            : "inline-flex h-8 items-center justify-center rounded-md border border-red-400 bg-red-100 px-3 text-xs font-black text-red-800 transition-colors hover:bg-red-200 disabled:opacity-60"
        }
      >
        {isPending
          ? "جارٍ التنفيذ..."
          : mode === "soft"
          ? "حذف المحدد"
          : mode === "restore"
          ? "استعادة المحدد"
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
        confirmLabel={mode === "soft" ? "نعم، حذف" : mode === "restore" ? "نعم، استعادة" : "نعم، حذف نهائي"}
        variant={mode === "restore" ? "info" : "danger"}
        isLoading={isPending}
      />
    </>
  );
}

export function SelectAllCheckbox({ formId }: { formId: string }) {
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

    // Listen to changes
    form.addEventListener("change", updateState);
    
    // Listen to DOM mutations (when rows are deleted/refreshed)
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
    // Trigger external change for bulk action button
    const event = new Event("change", { bubbles: true });
    form.dispatchEvent(event);
  };

  return (
    <input
      type="checkbox"
      checked={isChecked}
      onChange={handleChange}
      title="تحديد الكل"
      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
    />
  );
}

export function EmptyRecycleBinButton({ disabled }: { disabled?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const router = useRouter();

  const handleConfirm = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/empty-recycle-bin", { method: "POST" });
        const data = await res.json();
        setConfirmOpen(false);
        if (res.ok) {
          // FIX UX-01: استبدال alert() بـ feedback banner مدمج
          setFeedback({ type: "success", message: `تم تفريغ المحذوفات بنجاح (${data.count ?? 0} سجل)` });
          router.refresh();
        } else {
          setFeedback({ type: "error", message: data.error ?? "حدث خطأ أثناء تفريغ المحذوفات" });
        }
      } catch {
        setConfirmOpen(false);
        setFeedback({ type: "error", message: "فشل الاتصال بالخادم" });
      }
    });
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => { setFeedback(null); setConfirmOpen(true); }}
          disabled={isPending || disabled}
          className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-black text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60"
        >
          {isPending ? "جارٍ التفريغ..." : "إفراغ المحذوفات بالكامل"}
        </button>
        {feedback && (
          <p className={`text-xs font-bold px-1 ${feedback.type === "success" ? "text-emerald-700" : "text-red-600"}`}>
            {feedback.message}
          </p>
        )}
      </div>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="تأكيد تفريغ سلة المحذوفات"
        description="سيتم حذف جميع السجلات الموجودة في المحذوفات (والتي لا تحتوي على معاملات) حذفاً نهائياً لا رجعة فيه. هل أنت متأكد من رغبتك في المتابعة؟"
        confirmLabel="نعم، إفراغ المحذوفات"
        variant="danger"
        isLoading={isPending}
      />
    </>
  );
}
