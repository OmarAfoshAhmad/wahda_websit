"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X, Loader2 } from "lucide-react";
import { Card } from "./ui";
import { deleteFacility } from "@/app/actions/facility";

interface Props {
  id: string;
  name: string;
  transactionCount: number;
}

export function FacilityDeleteButton({ id, name, transactionCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTransactions = transactionCount > 0;

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    const result = await deleteFacility(id);
    setLoading(false);
    if (result.error) {
      setError(result.error);
    } else {
      setOpen(false);
      router.refresh();
    }
  };

  return (
    <>
      <button
        onClick={() => { if (!hasTransactions) { setOpen(true); setError(null); } }}
        disabled={hasTransactions}
        className={
          hasTransactions
            ? "inline-flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-300"
            : "inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-500 transition-colors hover:bg-red-100"
        }
        title={
          hasTransactions
            ? `لا يمكن الحذف — يحتوي على ${transactionCount} عملية مسجّلة`
            : "حذف المرفق"
        }
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
              <h2 className="text-base font-black text-slate-900">تأكيد الحذف</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-1.5 text-sm text-slate-600">هل أنت متأكد من حذف المرفق:</p>
            <p className="mb-4 font-bold text-slate-900">{name}</p>
            <p className="mb-5 text-xs text-slate-500">
              سيتم إخفاء المرفق من النظام (حذف ناعم). لا يمكن التراجع عن هذا الإجراء.
            </p>

            {error && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                تأكيد الحذف
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
