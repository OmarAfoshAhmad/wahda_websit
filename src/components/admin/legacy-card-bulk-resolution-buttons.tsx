"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers3, Loader2, Merge, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { bulkResolveLegacyCardsAction } from "@/app/actions/legacy-card-resolution";

export function LegacyCardBulkResolutionButton({
  mode,
  count,
}: {
  mode: "merge_confirmed" | "delete_without_replacement";
  count: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMerge = mode === "merge_confirmed";

  const run = () => {
    const confirmation = isMerge
      ? `سيتم معالجة ${count.toLocaleString("ar-LY")} بطاقة: الاحتفاظ بالبطاقات ذات الحركات اليدوية، واعتماد البديل الحديث ونقل حركات القديمة إليه عند وجوده. حركة IMPORT ليست دليل إصدار. هل تريد المتابعة؟`
      : `سيتم حذف ${count.toLocaleString("ar-LY")} بطاقة قديمة بلا بديل حذفاً ناعماً. ستبقى الحركات المالية محفوظة. هل تريد المتابعة؟`;
    if (!window.confirm(confirmation)) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await bulkResolveLegacyCardsAction(mode);
      if (result.error) setError(result.error);
      else {
        setMessage(result.success ?? "تمت المعالجة");
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={isMerge ? "primary" : "danger"} disabled={pending || count === 0} onClick={run} className="h-9 text-xs">
        {pending ? <Loader2 className="ml-1.5 h-4 w-4 animate-spin" /> : isMerge ? <Merge className="ml-1.5 h-4 w-4" /> : <Trash2 className="ml-1.5 h-4 w-4" />}
        {pending ? "جارٍ المعالجة..." : isMerge ? `دمج الكل (${count.toLocaleString("ar-LY")})` : `حذف الكل (${count.toLocaleString("ar-LY")})`}
      </Button>
      {!pending && <Layers3 className="h-4 w-4 text-slate-400" />}
      {message ? <span className="text-xs font-bold text-emerald-700">{message}</span> : null}
      {error ? <span className="text-xs font-bold text-red-600">{error}</span> : null}
    </div>
  );
}
