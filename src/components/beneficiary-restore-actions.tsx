"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2, X, Loader2, AlertTriangle } from "lucide-react";
import { Button, Card } from "./ui";
import { restoreBeneficiary, permanentDeleteBeneficiary } from "@/app/actions/beneficiary";

interface Props {
  id: string;
  name: string;
  hasTransactions: boolean;
}

export function BeneficiaryRestoreActions({ id, name, hasTransactions }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<null | "restore" | "delete">(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // إغلاق بمفتاح Escape
  React.useEffect(() => {
    if (!modal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) setModal(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modal, loading]);

  const handleAction = async () => {
    setLoading(true);
    setError(null);
    try {
      const result =
        modal === "restore"
          ? await restoreBeneficiary(id)
          : await permanentDeleteBeneficiary(id);
      if (result.error) {
        setError(result.error);
      } else {
        setModal(null);
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
      {/* زر استرجاع */}
      <button
        type="button"
        onClick={() => { setModal("restore"); setError(null); }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100"
        title="استرجاع المستفيد"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      {/* زر حذف نهائي */}
      <button
        type="button"
        onClick={() => { if (!hasTransactions) { setModal("delete"); setError(null); } }}
        disabled={hasTransactions}
        className={
          hasTransactions
            ? "inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-300"
            : "inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-600 transition-colors hover:bg-red-100"
        }
        title={hasTransactions ? "لا يمكن الحذف النهائي لمستفيد لديه حركات" : "حذف نهائي"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* نافذة التأكيد */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <Card className="w-full max-w-sm p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {modal === "restore" ? "استرجاع المستفيد" : "حذف نهائي"}
              </h2>
              <button type="button" onClick={() => setModal(null)} className="rounded-md p-1 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200">
                <X className="h-5 w-5" />
              </button>
            </div>

            {modal === "delete" && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>هذا الإجراء <strong>لا يمكن التراجع عنه</strong>. سيُحذف المستفيد نهائياً من قاعدة البيانات.</p>
              </div>
            )}

            <p className="mb-1.5 text-sm text-slate-600 dark:text-slate-300">
              {modal === "restore" ? "هل تريد استرجاع المستفيد:" : "هل أنت متأكد من الحذف النهائي للمستفيد:"}
            </p>
            <p className="mb-5 font-bold text-slate-900 dark:text-slate-100">{name}</p>

            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant={modal === "delete" ? "danger" : "primary"}
                onClick={handleAction}
                disabled={loading}
                className="flex-1"
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جارٍ التنفيذ...
                  </span>
                ) : modal === "restore" ? (
                  <span className="flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4" />
                    نعم، استرجع
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Trash2 className="h-4 w-4" />
                    نعم، احذف نهائياً
                  </span>
                )}
              </Button>
              <Button variant="outline" onClick={() => setModal(null)} className="flex-1">
                إلغاء
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
