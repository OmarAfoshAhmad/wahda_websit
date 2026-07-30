"use client";

import { useEffect, useState } from "react";
import { CheckSquare2, Square, XSquare } from "lucide-react";
import { Button } from "@/components/ui";
import { BatchMergeButton } from "@/components/batch-merge-button";

export function BulkMergeSelectionControls({ formId }: { formId: string }) {
  const [selectedCount, setSelectedCount] = useState(0);

  const getCheckboxes = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-bulk-merge-form="${formId}"]`));

  const setAll = (checked: boolean) => {
    const checkboxes = getCheckboxes();
    for (const checkbox of checkboxes) {
      checkbox.checked = checked;
    }
    setSelectedCount(checked ? checkboxes.length : 0);
  };

  useEffect(() => {
    const handleChange = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.dataset.bulkMergeForm === formId) {
        const checkboxes = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[data-bulk-merge-form="${formId}"]`),
        );
        setSelectedCount(checkboxes.filter((checkbox) => checkbox.checked).length);
      }
    };
    document.addEventListener("change", handleChange);
    return () => document.removeEventListener("change", handleChange);
  }, [formId]);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/30 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="strategy"
          defaultValue="ZERO_PRIORITY"
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900"
          aria-label="قاعدة اختيار السجل المعتمد"
        >
          <option value="ZERO_PRIORITY">أولوية البطاقة ذات الأصفار</option>
          <option value="NON_ZERO_PRIORITY">أولوية البطاقة بدون أصفار</option>
          <option value="LOWEST_BALANCE">أقل رصيد</option>
          <option value="HIGHEST_TRANSACTIONS">أعلى عدد معاملات</option>
        </select>
        <Button type="button" variant="outline" className="h-10 gap-2 text-xs" onClick={() => setAll(true)}>
          <CheckSquare2 className="h-4 w-4" />
          تحديد الكل
        </Button>
        <Button type="button" variant="outline" className="h-10 gap-2 text-xs" onClick={() => setAll(false)}>
          <XSquare className="h-4 w-4" />
          إلغاء التحديد
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
          <Square className="h-4 w-4" />
          المحدد: {selectedCount}
        </span>
        <BatchMergeButton label="دمج المحدد" disabled={selectedCount === 0} />
      </div>
    </div>
  );
}
