"use client";

import React, { useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Download } from "lucide-react";
import { Button, Card } from "./ui";
import type { TransactionImportResult, NotFoundRow } from "@/lib/import-transactions";

export function TransactionImportUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<TransactionImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingReport, setDownloadingReport] = useState(false);

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

      const response = await fetch("/api/import-transactions", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json() as { error?: string; result?: TransactionImportResult };

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

  const handleDownloadNotFound = async (rows: NotFoundRow[]) => {
    setDownloadingReport(true);
    try {
      const response = await fetch("/api/import-transactions/not-found-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });

      if (!response.ok) {
        setError("فشل تنزيل تقرير الغير موجودين.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `غير-موجودين-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("فشل تنزيل التقرير.");
    } finally {
      setDownloadingReport(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card className="border border-slate-200 dark:border-slate-800 p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-primary dark:text-blue-400">
          <FileSpreadsheet className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">رفع ملف الحركات</h3>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-7 text-slate-500 dark:text-slate-400">
            اختر ملف Excel يحتوي على حقول <b>رقم البطاقة</b> و<b>الاسم</b> و<b>عدد الافراد</b> و<b>الرصيد الكلي</b> و<b>الرصيد المستخدم</b>.
          </p>
        </div>

        <input
          type="file"
          id="tx-file-upload"
          className="hidden"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
        />

        <div className="mx-auto mt-5 flex w-full max-w-sm flex-col items-center space-y-3">
          <Button
            variant="outline"
            className="h-12 w-full"
            disabled={uploading}
            onClick={() => document.getElementById("tx-file-upload")?.click()}
          >
            {file ? file.name : "اختيار الملف"}
          </Button>

          <Button
            className="w-full h-12"
            disabled={!file || uploading}
            onClick={handleUpload}
          >
            {uploading ? (
              <><Loader2 className="ml-2 h-5 w-5 animate-spin" /><span className="mr-2">جارٍ معالجة الملف…</span></>
            ) : (
              <><Upload className="h-5 w-5" /><span className="mr-2">بدء استيراد الحركات</span></>
            )}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="flex items-center rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400">
          <AlertCircle className="ml-3 h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {result && (
        <Card className="border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h4 className="text-base font-black text-slate-900 dark:text-white">اكتمل الاستيراد</h4>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatBox label="إجمالي الصفوف" value={result.totalRows} />
            <StatBox label="أسر مستوردة" value={result.importedFamilies} color="emerald" />
            <StatBox label="حركات مُسجَّلة" value={result.importedTransactions} color="emerald" />
            <StatBox label="أسر انتهى رصيدها (صُفِّر)" value={result.suspendedFamilies} color="amber" />
            <StatBox label="مستورد مسبقاً" value={result.skippedAlreadyImported} color="slate" />
            <StatBox label="منتهٍ مسبقاً" value={result.skippedAlreadySuspended} color="slate" />
            <StatBox label="غير موجودين" value={result.skippedNotFound} color="red" />
          </div>

          {result.notFoundRows.length > 0 && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-amber-800 dark:text-amber-400">
                    {result.notFoundRows.length} موظف غير موجود في المنظومة
                  </p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-500">
                    حرکاتهم لم تُستورد. نزّل التقرير لمراجعتهم وإضافتهم ثم أعد الاستيراد.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0 h-9 border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900"
                  disabled={downloadingReport}
                  onClick={() => handleDownloadNotFound(result.notFoundRows)}
                >
                  {downloadingReport ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span className="mr-1.5">تنزيل التقرير</span>
                </Button>
              </div>
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
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-black ${colorMap[color]}`}>{value}</p>
    </div>
  );
}
