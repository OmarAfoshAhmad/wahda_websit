"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rollbackPurgeLegacyAction } from "@/app/actions/beneficiary/merge";
import { RefreshCw, RotateCcw } from "lucide-react";

type Props = {
  logId: string;
  isUndone?: boolean;
};

export function PurgeRollbackButton({ logId, isUndone }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isUndone) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
        ✓ تم التراجع (استعادة) مسبقاً
      </span>
    );
  }

  const handleRollback = () => {
    if (isPending) return;
    if (!window.confirm("هل أنت متأكد من التراجع عن عملية التصفية (الحذف) لهذه البطاقة؟ سيتم استعادة سجل المستفيد ولكن قد تحتاج لمراجعة الحركات يدوياً.")) return;

    setError(null);
    startTransition(async () => {
      const result = await rollbackPurgeLegacyAction(logId);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleRollback}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 text-[11px] font-black text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-all disabled:opacity-50"
        title="استعادة السجل المحذوف"
      >
        {isPending ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCcw className="h-3 w-3" />
        )}
        {isPending ? "جارٍ الاستعادة..." : "تراجع واستعادة"}
      </button>
      {error && <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1 rounded">{error}</span>}
    </div>
  );
}
