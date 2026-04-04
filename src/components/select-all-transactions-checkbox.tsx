"use client";

import { useEffect, useState } from "react";

export function SelectAllTransactionsCheckbox() {
  const [isChecked, setIsChecked] = useState(false);

  useEffect(() => {
    // تحديث حالة الزر الرئيسي بناءً على تحديد المربعات الفردية
    const updateMainCheckbox = () => {
      const allCheckboxes = document.querySelectorAll<HTMLInputElement>('input[data-bulk-tx-checkbox="1"]:not(:disabled)');
      const checkedCheckboxes = document.querySelectorAll<HTMLInputElement>('input[data-bulk-tx-checkbox="1"]:not(:disabled):checked');
      
      if (allCheckboxes.length > 0) {
        setIsChecked(allCheckboxes.length === checkedCheckboxes.length);
      } else {
        setIsChecked(false);
      }
    };

    document.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      if (target?.dataset?.bulkTxCheckbox === "1") {
        updateMainCheckbox();
      }
    });

    return () => {
      document.removeEventListener("change", updateMainCheckbox);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setIsChecked(checked);
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[data-bulk-tx-checkbox="1"]:not(:disabled)');
    checkboxes.forEach(cb => {
      if (cb.checked !== checked) {
        cb.checked = checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={isChecked}
        onChange={handleChange}
        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
        title="تحديد الكل في هذه الصفحة"
      />
      <span>تحديد</span>
    </div>
  );
}
