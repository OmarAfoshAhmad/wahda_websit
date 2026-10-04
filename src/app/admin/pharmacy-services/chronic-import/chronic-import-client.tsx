"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react";
import {
  applyChronicDrugImport,
  downloadChronicImportTemplate,
  previewChronicDrugImport,
  type ChronicImportMode,
  type ChronicImportRowResult,
} from "@/app/actions/pharmacy-chronic-import";
import { Button, Card } from "@/components/ui";

type Summary = { total: number; newCount: number; existingCount: number; errorCount: number; duplicateCount: number; warningCount: number; beneficiaryCount: number };
type Filter = "ALL" | "ERROR" | "WARNING" | "NEW" | "DUPLICATE";

function saveBase64(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function saveErrorRows(rows: ChronicImportRowResult[]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [["رقم الصف", "رقم البطاقة", "اسم المستفيد", "اسم الدواء", "ملاحظات", "سبب الخطأ"], ...rows.map((row) => [String(row.rowNumber), row.card, row.beneficiaryName, row.drugName, row.notes, row.message ?? ""])];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.map((line) => line.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "صفوف_مرفوضة.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function ChronicImportClient({ companies }: { companies: Array<{ id: string; name: string }> }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState("");
  const [mode, setMode] = useState<ChronicImportMode>("ADD");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ChronicImportRowResult[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [error, setError] = useState("");
  const [result, setResult] = useState<string>("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pending, startTransition] = useTransition();

  const visibleRows = useMemo(() => rows.filter((row) => filter === "ALL" || (filter === "ERROR" && row.status === "ERROR") || (filter === "WARNING" && row.warning) || (filter === "NEW" && row.status === "NEW") || (filter === "DUPLICATE" && row.status === "DUPLICATE")).slice(0, 500), [rows, filter]);

  const reset = () => { setSummary(null); setRows([]); setResult(""); setError(""); setConfirmReplace(false); };

  const preview = (selected: File, company: string) => {
    reset();
    startTransition(async () => {
      const base64 = await toBase64(selected);
      setFileBase64(base64);
      const response = await previewChronicDrugImport(company, base64);
      if ("error" in response && response.error) { setError(response.error); return; }
      if ("summary" in response && response.summary && response.rows) { setSummary(response.summary); setRows(response.rows); setFilter(response.summary.errorCount > 0 ? "ERROR" : "ALL"); }
    });
  };

  const apply = () => {
    if (mode === "REPLACE" && !confirmReplace) { setConfirmReplace(true); return; }
    setError("");
    startTransition(async () => {
      const response = await applyChronicDrugImport(companyId, fileBase64, mode);
      if ("error" in response && response.error) { setError(response.error); return; }
      if ("success" in response) {
        setResult(`تم الاستيراد لـ ${response.beneficiaries} مستفيد: ${response.created} ربط جديد، ${response.reactivated} أعيد تفعيله، ${response.updatedNotes} تحديث ملاحظات${mode === "REPLACE" ? `، ${response.deactivated} أوقف` : ""}. الصفوف المرفوضة: ${response.summary.errorCount}.`);
        setConfirmReplace(false);
      }
    });
  };

  const template = () => startTransition(async () => {
    const response = await downloadChronicImportTemplate();
    if ("base64" in response && response.base64) saveBase64(response.fileName, response.base64);
    else setError(response.error ?? "تعذر تنزيل القالب");
  });

  const validCount = summary ? summary.newCount + summary.existingCount : 0;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-black text-slate-900 dark:text-white">1. جهّز الملف</h2>
            <p className="text-sm text-slate-500">صف لكل دواء لكل مستفيد. الأعمدة: رقم البطاقة، اسم المستفيد (للتحقق)، اسم الدواء، ملاحظات.</p>
          </div>
          <Button type="button" variant="outline" onClick={template} disabled={pending} className="h-9 text-sm"><Download className="h-4 w-4" /> تنزيل القالب</Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="chronic-company" className="text-sm font-bold text-slate-600 dark:text-slate-300">2. الشركة</label>
            <select id="chronic-company" value={companyId} onChange={(event) => { setCompanyId(event.target.value); if (file) preview(file, event.target.value); }} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-bold text-slate-600 dark:text-slate-300">3. ملف Excel (xlsx)</span>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-teal-400 px-3 text-sm font-bold text-teal-700 focus-within:ring-2 focus-within:ring-teal-500 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/30">
              <Upload className="h-4 w-4 shrink-0" />
              <span className="truncate">{file ? file.name : "اختر الملف"}</span>
              <input type="file" accept=".xlsx" className="sr-only" disabled={!companyId || pending} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) { setFile(selected); preview(selected, companyId); } }} />
            </label>
          </div>
        </div>
        {companies.length === 0 && <p className="text-sm font-bold text-amber-700">لا توجد شركة لها سياسة أدوية فعالة.</p>}
      </Card>

      {pending && <div className="flex items-center gap-2 text-sm font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ المعالجة…</div>}
      {error && <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"><XCircle className="h-4 w-4 shrink-0" /> {error}</div>}
      {result && <div role="status" className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" /> {result}</div>}

      {summary && (
        <Card className="space-y-4 p-4 sm:p-5">
          <h2 className="text-base font-black text-slate-900 dark:text-white">4. راجع النتيجة</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            {[
              ["الصفوف", summary.total, "ALL"],
              ["ربط جديد", summary.newCount, "NEW"],
              ["موجود مسبقًا", summary.existingCount, "ALL"],
              ["مرفوض", summary.errorCount, "ERROR"],
              ["مكرر يُتجاهل", summary.duplicateCount, "DUPLICATE"],
              ["تنبيه اسم", summary.warningCount, "WARNING"],
            ].map(([label, value, target]) => (
              <button key={label as string} type="button" onClick={() => setFilter(target as Filter)} className={`rounded-md border p-2 text-start ${filter === target ? "border-teal-500 bg-teal-50 dark:bg-teal-950/30" : "border-slate-200 dark:border-slate-700"}`}>
                <div className="text-xs font-bold text-slate-500">{label}</div>
                <div className="text-lg font-black tabular-nums text-slate-900 dark:text-white">{value as number}</div>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800">
                <tr><th className="p-2 text-start">الصف</th><th className="p-2 text-start">رقم البطاقة</th><th className="p-2 text-start">المستفيد</th><th className="p-2 text-start">الدواء</th><th className="p-2 text-start">الحالة</th></tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-2 tabular-nums">{row.rowNumber}</td>
                    <td className="p-2" dir="ltr">{row.card}</td>
                    <td className="p-2">{row.beneficiaryName}{row.warning && <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> {row.warning}</div>}</td>
                    <td className="p-2" dir="auto">{row.drugName}{row.notes && <div className="text-xs text-slate-500">{row.notes}</div>}</td>
                    <td className="p-2">{row.status === "ERROR" ? <span className="text-xs font-bold text-rose-700">{row.message}</span> : row.status === "DUPLICATE" ? <span className="text-xs font-bold text-slate-500">مكرر</span> : row.status === "NEW" ? <span className="text-xs font-bold text-emerald-700">جديد</span> : <span className="text-xs font-bold text-slate-500">موجود</span>}</td>
                  </tr>
                ))}
                {visibleRows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-sm text-slate-500">لا توجد صفوف في هذا التصنيف</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > 500 && <p className="text-xs text-slate-500">يُعرض أول 500 صف من التصنيف المختار.</p>}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="sr-only">وضع الاستيراد</legend>
              <label className="flex items-center gap-1.5 font-bold"><input type="radio" name="mode" checked={mode === "ADD"} onChange={() => { setMode("ADD"); setConfirmReplace(false); }} /> إضافة وتحديث</label>
              <label className="flex items-center gap-1.5 font-bold"><input type="radio" name="mode" checked={mode === "REPLACE"} onChange={() => setMode("REPLACE")} /> استبدال قائمة كل مستفيد في الملف</label>
            </fieldset>
            {summary.errorCount > 0 && <Button type="button" variant="outline" onClick={() => saveErrorRows(rows.filter((row) => row.status === "ERROR"))} className="h-9 text-sm"><FileSpreadsheet className="h-4 w-4" /> تنزيل الصفوف المرفوضة</Button>}
            <Button type="button" onClick={apply} disabled={pending || validCount === 0} className="h-9 text-sm ms-auto">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmReplace ? `تأكيد الاستبدال لـ ${summary.beneficiaryCount} مستفيد` : `استيراد ${validCount} صف سليم`}
            </Button>
          </div>
          {confirmReplace && <p className="text-sm font-bold text-amber-700">سيتم إيقاف أي دواء مرتبط بهؤلاء المستفيدين غير موجود في الملف. اضغط مرة أخرى للتأكيد.</p>}
        </Card>
      )}
    </div>
  );
}
