"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { bulkUpdateLegacyCardMarker } from "@/app/actions/beneficiary";
import { Button, Input } from "@/components/ui";

export function LegacyCardBatchTools() {
  const [pattern, setPattern] = useState("765");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (setLegacy: boolean) => {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const res = await bulkUpdateLegacyCardMarker({ pattern, setLegacy });
      if (res.error) {
        setError(res.error);
        return;
      }

      setMessage(
        setLegacy
          ? `تم وسم ${Number(res.updatedCount ?? 0).toLocaleString("ar-LY")} بطاقة كقديمة.`
          : `تم تحويل ${Number(res.updatedCount ?? 0).toLocaleString("ar-LY")} بطاقة إلى مستقرة.`
      );
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-2 py-2">
      <span className="text-xs font-black text-slate-500 dark:text-slate-400">نمط البطاقة</span>
      <Input
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        className="h-9 w-24"
        placeholder="765"
      />
      <Button
        type="button"
        variant="outline"
        className="h-9"
        disabled={isPending}
        onClick={() => run(false)}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        تحويل إلى مستقرة
      </Button>
      {message && <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{message}</span>}
      {error && <span className="text-xs font-bold text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
