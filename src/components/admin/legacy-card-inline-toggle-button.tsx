"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setSingleLegacyCardMarker } from "@/app/actions/beneficiary";

type Props = {
  beneficiaryId: string;
  isLegacyCard: boolean;
};

export function LegacyCardInlineToggleButton({ beneficiaryId, isLegacyCard }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const nextState = !isLegacyCard;
  const label = isLegacyCard ? "تحويل إلى مستقرة" : "وسم كقديمة";

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await setSingleLegacyCardMarker({
        id: beneficiaryId,
        setLegacy: nextState,
      });

      if (res.error) {
        setError(res.error);
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
      >
        {isPending && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />}
        {label}
      </button>
      {error ? <span className="text-[11px] font-bold text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}
