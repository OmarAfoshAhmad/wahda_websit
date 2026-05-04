"use client";

import { useState, useTransition } from "react";
import { Loader2, SearchCheck } from "lucide-react";
import { checkOrphanedNotificationsAction } from "@/app/actions/balance-health-actions";

export function OrphanedNotificationsCheckButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  const handleCheck = () => {
    setError(null);
    startTransition(async () => {
      const res = await checkOrphanedNotificationsAction();
      if (!res.success) {
        setError(res.error ?? "تعذر تنفيذ الفحص");
        return;
      }
      setCount(res.count);
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleCheck}
        disabled={isPending}
        className="inline-flex h-10 w-56 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
        فحص الإشعارات اليتيمة
      </button>

      {count !== null && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-400">
          نتيجة الفحص: {count.toLocaleString("ar-LY")} إشعار يتيم.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
