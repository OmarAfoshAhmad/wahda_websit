"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldMinus } from "lucide-react";
import { bulkUpdateFacilityPermission } from "@/app/actions/facility";
import { FACILITY_TYPES, getFacilityTypeLabel, type FacilityType } from "@/lib/facility-type";
import { PERMISSION_DEFINITIONS, type PermissionKey } from "@/lib/permission-catalog";
import { Button } from "@/components/ui";

export function FacilityBulkPermissions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [facilityType, setFacilityType] = useState<FacilityType>("HOSPITAL");
  const [permission, setPermission] = useState<PermissionKey>("deduct_balance");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (operation: "GRANT" | "REVOKE") => {
    const label = PERMISSION_DEFINITIONS.find((item) => item.key === permission)?.label ?? permission;
    const verb = operation === "GRANT" ? "منح" : "سحب";
    if (!window.confirm(`${verb} صلاحية «${label}» ${operation === "GRANT" ? "لجميع" : "من جميع"} مرافق نوع «${getFacilityTypeLabel(facilityType)}»؟`)) return;
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
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20 print:hidden">
      <h2 className="font-black text-slate-900 dark:text-white">الصلاحيات الجماعية حسب نوع المرفق</h2>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">تُطبق على المرافق الصحية النشطة فقط، ولا تشمل المشرفين أو المديرين أو الموظفين.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-[220px_1fr_auto_auto]">
        <select value={facilityType} onChange={(e) => setFacilityType(e.target.value as FacilityType)} className="h-10 rounded-md border bg-white px-3 text-sm dark:bg-slate-900">
          {FACILITY_TYPES.map((type) => <option key={type} value={type}>{getFacilityTypeLabel(type)}</option>)}
        </select>
        <select value={permission} onChange={(e) => setPermission(e.target.value as PermissionKey)} className="h-10 rounded-md border bg-white px-3 text-sm dark:bg-slate-900">
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
    </div>
  );
}
