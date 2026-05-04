"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rollbackMigrationAction } from "@/app/actions/card-numbering";
import { RefreshCw, RotateCcw } from "lucide-react";

type Props = {
  logId: string;
  isRolledBack?: boolean;
};

export function MigrationRollbackButton({ logId, isRolledBack }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isRolledBack) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
        ✓ تم التراجع مسبقاً
      </span>
    );
  }

  const handleRollback = () => {
    if (isPending) return;
    if (!window.confirm("هل أنت متأكد من التراجع عن عملية الترحيل هذه؟ سيتم إعادة البطاقات القديمة للمستفيدين وحذف السجلات الجديدة المضافة.")) return;

    setError(null);
    startTransition(async () => {
      const result = await rollbackMigrationAction(logId);
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
        className="inline-flex items-center gap-1.5 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-2.5 py-1 text-[11px] font-black text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-all disabled:opacity-50"
        title="التراجع عن الترحيل"
      >
        {isPending ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCcw className="h-3 w-3" />
        )}
        {isPending ? "جارٍ التراجع..." : "تراجع عن الترحيل"}
      </button>
      {error && <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 px-1 rounded">{error}</span>}
    </div>
  );
}
