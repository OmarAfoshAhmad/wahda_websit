"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, ShieldCheck, ShieldMinus } from "lucide-react";
import { bulkUpdateFacilityPermission } from "@/app/actions/facility";
import { FACILITY_TYPES, getFacilityTypeLabel, type FacilityType } from "@/lib/facility-type";
import { PERMISSION_DEFINITIONS, type PermissionKey } from "@/lib/permission-catalog";
import { Button } from "@/components/ui";

export function FacilityBulkPermissions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [facilityType, setFacilityType] = useState<FacilityType | "ALL">("ALL");
  const [permission, setPermission] = useState<PermissionKey>("deduct_balance");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (operation: "GRANT" | "REVOKE") => {
    const label = PERMISSION_DEFINITIONS.find((item) => item.key === permission)?.label ?? permission;
    const verb = operation === "GRANT" ? "منح" : "سحب";
    const targetLabel = facilityType === "ALL" ? "كل أنواع المرافق" : getFacilityTypeLabel(facilityType);
    if (!window.confirm(`${verb} صلاحية «${label}» ${operation === "GRANT" ? "لجميع" : "من جميع"} مرافق «${targetLabel}»؟`)) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await bulkUpdateFacilityPermission({ facilityType, permission, operation });
      if (result.error) setError(result.error);
      else {
        setMessage(`${result.success} (المطابق: ${(result.matched ?? 0).toLocaleString("ar-LY")})`);
        router.refresh();
      }
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 print:hidden">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right">
        <div>
          <h2 className="font-black text-slate-900 dark:text-white">الصلاحيات الجماعية للمرافق</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">منح أو سحب صلاحية من نوع محدد أو من كل المرافق دفعة واحدة.</p>
        </div>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-slate-200 bg-blue-50/50 p-4 dark:border-slate-700 dark:bg-blue-950/20">
      <p className="text-xs text-slate-600 dark:text-slate-400">تطبق على المرافق الصحية النشطة فقط، ولا تشمل المشرفين أو المديرين أو الموظفين.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[220px_1fr_auto_auto]">
        <select value={facilityType} onChange={(event) => setFacilityType(event.target.value as FacilityType | "ALL")} className="h-10 rounded-md border bg-white px-3 text-sm dark:bg-slate-900">
          <option value="ALL">كل أنواع المرافق</option>
          {FACILITY_TYPES.map((type) => <option key={type} value={type}>{getFacilityTypeLabel(type)}</option>)}
        </select>
        <select value={permission} onChange={(event) => setPermission(event.target.value as PermissionKey)} className="h-10 rounded-md border bg-white px-3 text-sm dark:bg-slate-900">
          {PERMISSION_DEFINITIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <Button type="button" disabled={pending} onClick={() => run("GRANT")} className="h-10">
          {pending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="ml-2 h-4 w-4" />}منح للجميع
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => run("REVOKE")} className="h-10 border-red-300 text-red-700">
          <ShieldMinus className="ml-2 h-4 w-4" />سحب من الجميع
        </Button>
      </div>
      {message ? <p className="mt-2 text-xs font-bold text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-xs font-bold text-red-600">{error}</p> : null}
      </div>}
    </div>
  );
}
