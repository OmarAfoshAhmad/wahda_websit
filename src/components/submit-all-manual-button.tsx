"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { Loader2, CheckSquare } from "lucide-react";
import { bulkManualMergeAction } from "@/app/actions/bulk-manual-merge";

export function SubmitAllManualButton() {
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  const handleSubmitAll = () => {
    if (isPending || running) return;
    setRunning(true);
    
    startTransition(async () => {
      try {
        // Collect all manual merge forms (those with member_ids but without canonical_card)
        const forms = document.querySelectorAll("form");
        const payloadsData: Record<string, string | string[]>[] = [];

        for (let i = 0; i < forms.length; i++) {
          const form = forms[i];
          const hasMemberIds = form.querySelector('input[name="member_ids"]');
          const hasCanonical = form.querySelector('input[name="canonical_card"]');
          
          // Only manual merge forms (not group merge or audit forms)
          if (hasMemberIds && !hasCanonical && !form.id.startsWith("review-")) {
            const formData = new FormData(form);
            // Convert FormData to a plain object (with arrays for multi-value fields)
            const obj: Record<string, string | string[]> = {};
            for (const key of new Set(formData.keys())) {
              const values = formData.getAll(key).map(String);
              obj[key] = values.length === 1 ? values[0] : values;
            }
            payloadsData.push(obj);
          }
        }

        if (payloadsData.length === 0) {
          alert("لا توجد حالات محددة للمعالجة في هذه الصفحة.");
          setRunning(false);
          return;
        }

        // Send all payloads as a single JSON string in one FormData
        const wrapper = new FormData();
        wrapper.append("payloads", JSON.stringify(payloadsData));
        await bulkManualMergeAction(wrapper);
      } catch (err) {
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
