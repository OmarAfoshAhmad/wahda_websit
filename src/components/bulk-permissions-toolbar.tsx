"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCheck, ShieldMinus, ShieldPlus } from "lucide-react";
import { updateManagersPermissionBulk } from "@/app/actions/manager";
import { PERMISSION_DEFINITIONS, type PermissionKey } from "@/lib/permission-catalog";

const CHECKBOX_SELECTOR = 'input[name="bulk-account-id"]';

export function BulkPermissionsToolbar() {
  const [selectedCount, setSelectedCount] = useState(0);
  const [permission, setPermission] = useState<PermissionKey>("view_dashboard");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const getCheckboxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(CHECKBOX_SELECTOR));
  const refreshCount = () => setSelectedCount(getCheckboxes().filter((item) => item.checked).length);

  useEffect(() => {
    const onChange = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.name === "bulk-account-id") refreshCount();
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, []);

  const toggleAll = () => {
    const checkboxes = getCheckboxes();
    const shouldSelect = checkboxes.some((item) => !item.checked);
    checkboxes.forEach((item) => { item.checked = shouldSelect; });
    refreshCount();
  };

  const apply = (enabled: boolean) => {
    const ids = getCheckboxes().filter((item) => item.checked).map((item) => item.value);
    if (ids.length === 0) return setMessage("حدد حساباً واحداً على الأقل.");
    setMessage(null);
    startTransition(async () => {
      const result = await updateManagersPermissionBulk(ids, permission, enabled);
      setMessage(result.error ?? `تم ${enabled ? "منح" : "سحب"} الصلاحية من ${result.updatedCount ?? 0} حساب.`);
      if (!result.error) {
        getCheckboxes().forEach((item) => { item.checked = false; });
        setSelectedCount(0);
      }
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
        <button type="button" onClick={toggleAll} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-bold dark:border-slate-700">
          <CheckCheck className="h-4 w-4" /> تحديد الكل
        </button>
        <span className="shrink-0 text-xs font-black text-slate-600 dark:text-slate-300">المحدد: {selectedCount}</span>
        <select value={permission} onChange={(event) => setPermission(event.target.value as PermissionKey)} className="h-9 min-w-56 flex-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800">
          {PERMISSION_DEFINITIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <button type="button" disabled={isPending || selectedCount === 0} onClick={() => apply(true)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-xs font-black text-white disabled:opacity-50">
          <ShieldPlus className="h-4 w-4" /> منح للمحدد
        </button>
        <button type="button" disabled={isPending || selectedCount === 0} onClick={() => apply(false)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-red-600 px-3 text-xs font-black text-white disabled:opacity-50">
          <ShieldMinus className="h-4 w-4" /> سحب من المحدد
        </button>
      </div>
      {message && <p role="status" className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">{message}</p>}
    </div>
  );
}
