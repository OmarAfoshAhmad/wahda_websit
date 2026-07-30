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
        // Collect all forms belonging to manual merge by looking for the hidden input member_ids
        const forms = document.querySelectorAll("form");
        const payloads: FormData[] = [];

        for (let i = 0; i < forms.length; i++) {
          const form = forms[i];
          const hasMemberIds = form.querySelector('input[name="member_ids"]');
          const hasCanonical = form.querySelector('input[name="canonical_card"]');
          
          // We only want the manual merge forms, which don't have canonical_card (that's the group merge)
          // but do have member_ids and q, pz, pn
          if (hasMemberIds && !hasCanonical && !form.id.includes("review-")) {
            const formData = new FormData(form);
            payloads.push(formData);
          }
        }

        if (payloads.length === 0) {
          alert("لا توجد حالات محددة للمعالجة في هذه الصفحة.");
          setRunning(false);
          return;
        }

        await bulkManualMergeAction(payloads);
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
