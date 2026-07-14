"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { ConfirmationModal } from "@/components/confirmation-modal";

type Props = {
  target: "all" | "beneficiaries" | "transactions" | "facilities" | "completed";
  actor: string;
  startDate: string;
  endDate: string;
};

export function AuditLogClearButton({ target, actor, startDate, endDate }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const onClear = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/audit-log/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          actor,
          start_date: startDate,
          end_date: endDate,
        }),
      });

      const data = (await res.json().catch(() => null)) as { deletedCount?: number; error?: string } | null;

      if (!res.ok) {
        setMessageType("error");
        setMessage(data?.error ?? "تعذر تفريغ سجل المراقبة");
        return;
      }

      setMessageType("success");
      setMessage(`تم تفريغ السجل بنجاح. عدد السجلات المحذوفة: ${data?.deletedCount ?? 0}`);
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setMessageType("error");
      setMessage("حدث خطأ أثناء تفريغ سجل المراقبة");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-black text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        تفريغ السجل
      </button>

      {message && (
        <div className={`mt-2 rounded-md px-3 py-2 text-xs font-bold ${messageType === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-red-200 bg-red-50 text-red-700"}`}>
          {message}
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onClear}
        title="تأكيد تفريغ السجل"
        description="هل أنت متأكد من تفريغ سجل المراقبة؟ لا يمكن التراجع عن هذه العملية."
        confirmLabel="نعم، تفريغ السجل"
        isLoading={loading}
        variant="danger"
      />
    </>
  );
}
