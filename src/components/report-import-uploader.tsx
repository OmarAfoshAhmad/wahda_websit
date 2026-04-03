"use client";

import React, { useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Download } from "lucide-react";
import { Button, Card } from "./ui";
import type { LegacyImportResult } from "@/lib/import-report";

export function ReportImportUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<LegacyImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setResult(null);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/import-report", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as { error?: string; result?: LegacyImportResult };
      if (!response.ok || payload.error) {
        setError(payload.error ?? "تعذر معالجة الملف.");
        return;
      }

      setResult(payload.result ?? null);
    } catch {
      setError("تعذر رفع الملف. تحقق من الاتصال وأعد المحاولة.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="border border-slate-200 p-6 text-center sm:p-8 dark:border-slate-800">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-blue-400">
          <FileSpreadsheet className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">رفع تقرير الحركات القديمة</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-slate-500 dark:text-slate-400">
            هذا المسار مخصص لتقرير الحركات القديم ذي الأعمدة التسعة. سيتم إدخال الحركات التاريخية ثم إعادة
            حساب الأرصدة الفعلية للمستفيدين المتأثرين مباشرة.
          </p>
          <a
            href="/قالب_استيراد_الحركات_القديمة.csv"
            download
            className="mx-auto mt-3 inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Download className="h-3.5 w-3.5" />
            تحميل قالب التقرير القديم
          </a>
        </div>

        <input
          type="file"
          id="legacy-report-upload"
          className="hidden"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
        />

        <div className="mx-auto mt-5 flex w-full max-w-sm flex-col items-center space-y-3">
          <Button
            variant="outline"
            className="h-12 w-full"
            disabled={uploading}
            onClick={() => document.getElementById("legacy-report-upload")?.click()}
          >
            {file ? file.name : "اختيار ملف التقرير"}
          </Button>

          <Button className="h-12 w-full" disabled={!file || uploading} onClick={handleUpload}>
            {uploading ? (
              <>
                <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                <span className="mr-2">جارٍ استيراد الحركات وإعادة الحساب…</span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span className="mr-2">بدء الاستيراد الشامل</span>
              </>
            )}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="flex items-center rounded-md border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="ml-3 h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {result && (
        <Card className="space-y-4 border border-slate-200 p-5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <h4 className="text-base font-black text-slate-900 dark:text-white">اكتمل الاستيراد وإعادة الحساب</h4>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatBox label="إجمالي الصفوف" value={result.totalRows} />
            <StatBox label="صفوف مستوردة" value={result.importedRows} color="emerald" />
            <StatBox label="موجود مسبقاً" value={result.existingRows} color="slate" />
            <StatBox label="المرافق الجديدة" value={result.createdFacilities} color="amber" />
            <StatBox label="المستفيدون الجدد" value={result.createdBeneficiaries} color="amber" />
            <StatBox label="ربط الإلغاءات" value={result.linkedCancellations} color="emerald" />
            <StatBox label="مستفيدون أُعيد حسابهم" value={result.recalculatedBeneficiaries} color="emerald" />
            <StatBox label="أرصدة متأثرة" value={result.balanceUpdatedBeneficiaries} color="emerald" />
            <StatBox label="التحذيرات" value={result.warnings.length} color={result.warnings.length ? "red" : "slate"} />
          </div>

          {result.warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
              <p className="font-black text-amber-800 dark:text-amber-400">تحذيرات أثناء القراءة</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-500">
                {result.warnings.slice(0, 10).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  color = "slate",
}: {
  label: string;
  value: number;
  color?: "slate" | "emerald" | "red" | "amber";
}) {
  const colorMap = {
    slate: "text-slate-900 dark:text-white",
    emerald: "text-emerald-700 dark:text-emerald-400",
    red: "text-red-700 dark:text-red-400",
    amber: "text-amber-700 dark:text-amber-400",
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-center dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-black ${colorMap[color]}`}>{value}</p>
    </div>
  );
}
