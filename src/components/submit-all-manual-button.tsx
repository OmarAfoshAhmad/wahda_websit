"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { Loader2, CheckSquare } from "lucide-react";
import { bulkManualMergeAction } from "@/app/actions/bulk-manual-merge";
import { isNextRouterError } from "next/dist/client/components/is-next-router-error";

type MergeState = {
  member_ids: string[];
  actions: Record<string, string>; // memberId -> targetId
  q: string;
  pz: number;
  pn: number;
  companyId: string;
};

export function SubmitAllManualButton() {
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  const handleSubmitAll = () => {
    if (isPending || running) return;
    setRunning(true);
    
    startTransition(async () => {
      try {
        // قراءة بيانات التحديدات من data-merge-state attribute (موثوق 100%)
        const forms = document.querySelectorAll<HTMLFormElement>("form[data-merge-state]");
        const payloadsData: Record<string, string | string[]>[] = [];

        for (let i = 0; i < forms.length; i++) {
          const form = forms[i];
          const stateJson = form.dataset.mergeState;
          if (!stateJson) continue;

          let state: MergeState;
          try {
            state = JSON.parse(stateJson);
          } catch {
            continue;
          }

          // تحقق: هل هناك أي عملية دمج فعلية (أي عضو يشير لعضو آخر)؟
          const hasMerge = state.member_ids.some(
            id => state.actions[id] && state.actions[id] !== id
          );
          // إذا لا يوجد أي دمج (كل الأعضاء مستقلون)، تجاهل هذه المجموعة
          if (!hasMerge) continue;

          // بناء الـ payload
          const obj: Record<string, string | string[]> = {
            q: state.q,
            pz: String(state.pz),
            pn: String(state.pn),
            companyId: state.companyId,
            member_ids: state.member_ids,
          };
          for (const memberId of state.member_ids) {
            obj[`action_${memberId}`] = state.actions[memberId] ?? memberId;
          }
          payloadsData.push(obj);
        }

        if (payloadsData.length === 0) {
          alert("لا توجد حالات محددة للمعالجة.\nتأكد أن كل مجموعة تريد دمجها فيها عضو واحد على الأقل مضبوط على الدمج.");
          setRunning(false);
          return;
        }

        // قراءة الاستراتيجية المختارة
        const strategySelect = document.querySelector<HTMLSelectElement>('select[name="strategy"]');
        const strategy = strategySelect?.value ?? "ZERO_PRIORITY";
        for (const payload of payloadsData) {
          payload["strategy"] = strategy;
        }

        const wrapper = new FormData();
        wrapper.append("payloads", JSON.stringify(payloadsData));
        await bulkManualMergeAction(wrapper);
      } catch (err) {
        // إذا كان الخطأ redirect أو navigation error من Next.js، أعد إلقاءه
        if (isNextRouterError(err)) throw err;
        console.error(err);
        alert("حدث خطأ أثناء إرسال البيانات");
      } finally {
        setRunning(false);
      }
    });
  };

  return (
    <Button
      type="button"
      onClick={handleSubmitAll}
      disabled={isPending || running}
      variant="primary"
      className="h-9 min-w-60 text-xs flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
    >
      {isPending || running ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <CheckSquare className="h-3 w-3" />
      )}
      {isPending || running ? "جاري معالجة التحديدات..." : "معالجة آمنة للتحديدات الحالية"}
    </Button>
  );
}
