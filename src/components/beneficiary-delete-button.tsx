"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X, Loader2 } from "lucide-react";
import { Button, Card } from "./ui";
import { deleteBeneficiary, restoreBeneficiary } from "@/app/actions/beneficiary";
import { ConfirmationModal } from "@/components/confirmation-modal";

interface Props {
  id: string;
  name: string;
  hasTransactions: boolean;
}

export function BeneficiaryDeleteButton({ id, name, hasTransactions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);

  // إغلاق بمفتاح Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, loading]);

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await deleteBeneficiary(id);
      if (result.error) {
        setError(result.error);
      } else {
        setOpen(false);
        setUndoOpen(true);
        router.refresh();
      }
    } catch {
      setError("خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { if (!hasTransactions) { setOpen(true); setError(null); } }}
        disabled={hasTransactions}
        className={hasTransactions
          ? "inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-300"
          : "inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 transition-colors hover:bg-red-100"
        }
        title={hasTransactions ? "لا يمكن حذف مستفيد لديه حركات مالية" : "حذف المستفيد (حذف ناعم)"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <Card className="w-full max-w-sm p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">تأكيد الحذف</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-1.5 text-sm text-slate-600 dark:text-slate-300">
              هل أنت متأكد من حذف المستفيد:
            </p>
            <p className="mb-4 font-bold text-slate-900 dark:text-slate-100">{name}</p>
            <p className="mb-5 text-xs text-slate-500 dark:text-slate-400">
              سيتم إخفاء المستفيد من النظام (حذف ناعم) مع الحفاظ على سجل حركاته.
            </p>

            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="danger" onClick={handleDelete} disabled={loading} className="flex-1">
                {loading ? <Loader2 className="ml-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="ml-1.5 h-4 w-4" />}
                {loading ? "جارٍ الحذف..." : "نعم، احذف"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="flex-1">
                إلغاء
              </Button>
            </div>
          </Card>
        </div>
      )}

      <ConfirmationModal
        isOpen={undoOpen}
        onClose={() => setUndoOpen(false)}
        onConfirm={async () => {
          setLoading(true);
          const restoreResult = await restoreBeneficiary(id);
          if (restoreResult.error) {
            setError(restoreResult.error);
          } else {
            setUndoOpen(false);
            router.refresh();
          }
          setLoading(false);
        }}
        isLoading={loading}
        error={error}
        title="تم حذف المستفيد"
        description="هل تريد التراجع الآن عن الحذف؟"
        confirmLabel="نعم، تراجع"
        variant="warning"
      />
    </>
  );
}
