"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Merge, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import {
  deleteUnusedLegacyCardAction,
  resolveLegacyCardWithReplacementAction,
} from "@/app/actions/legacy-card-resolution";

export function LegacyCardResolutionButton({
  legacyId,
  replacementId,
  hasUsage,
}: {
  legacyId: string;
  replacementId?: string;
  hasUsage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isMerge = Boolean(replacementId);

  const run = () => {
    const message = isMerge
      ? hasUsage
        ? "سيتم إبقاء البطاقة الحديثة، ونقل حركات القديمة إليها، وإعادة حساب الرصيد، ثم حذف الأصل حذفا ناعما. هل تريد المتابعة؟"
        : "سيتم إبقاء البطاقة الحديثة وحذف سجل البطاقة القديمة حذفا ناعما. هل تريد المتابعة؟"
      : hasUsage
        ? "لا توجد بطاقة حديثة مؤكدة. سيتم حذف البطاقة القديمة حذفاً ناعماً مع إبقاء حركاتها المالية محفوظة وتسجيل العملية. هل تريد المتابعة؟"
        : "لا توجد بطاقة حديثة مؤكدة. سيتم حذفها حذفاً ناعماً مع تسجيل العملية. هل تريد المتابعة؟";
    if (!window.confirm(message)) return;

    setError(null);
    startTransition(async () => {
      const result = replacementId
        ? await resolveLegacyCardWithReplacementAction(legacyId, replacementId)
        : await deleteUnusedLegacyCardAction(legacyId);
      if ("error" in result && result.error) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex min-w-40 flex-col items-start gap-1">
      <Button
        type="button"
        variant={isMerge ? "primary" : "danger"}
        className="h-8 px-3 text-xs"
        disabled={pending}
        onClick={run}
      >
        {pending ? <Loader2 className="ml-1.5 h-3.5 w-3.5 animate-spin" /> : isMerge && hasUsage ? <Merge className="ml-1.5 h-3.5 w-3.5" /> : <Trash2 className="ml-1.5 h-3.5 w-3.5" />}
        {pending ? "جارٍ التحقق..." : isMerge ? (hasUsage ? "دمج في الحديثة" : "حذف الأصل") : "حذف القديمة"}
      </Button>
      {error && <p className="max-w-64 text-[11px] font-bold text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
