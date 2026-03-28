"use client";

import React, { useState } from "react";
import { FileSpreadsheet, Upload, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react";
import { Button, Card } from "./ui";
import { importFacilitiesFromExcel } from "@/app/actions/facility";

type ImportResult = {
  created?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
};

export function FacilityImportUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await importFacilitiesFromExcel(formData);
      setResult(res);
      if (!res.error) {
        setFile(null);
        const input = document.getElementById("facility-file-upload") as HTMLInputElement;
        if (input) input.value = "";
      }
    } catch {
      setResult({ error: "خطأ في الاتصال. حاول مرة أخرى." });
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    window.location.href = "/api/export/facility-template";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
          <h2 className="text-base font-black text-slate-900 dark:text-white">استيراد مرافق من Excel</h2>
        </div>
        <button
          onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <Download className="h-3.5 w-3.5" />
          تحميل القالب
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        الملف يجب أن يحتوي على عمودي: <b>اسم المرفق</b> و <b>اسم المستخدم</b>. كلمة المرور الافتراضية: <code className="text-primary dark:text-blue-400">123456</code> (يجب التغيير عند الدخول الأول).
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <input
            type="file"
            id="facility-file-upload"
            className="hidden"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => document.getElementById("facility-file-upload")?.click()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-solid border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-600 dark:text-slate-300 hover:border-primary dark:hover:border-blue-500 hover:bg-primary-light dark:hover:bg-blue-900/20 hover:text-primary dark:hover:text-blue-400 disabled:opacity-50 transition-colors"
          >
            <Upload className="h-4 w-4" />
            {file ? file.name : "اختيار ملف Excel"}
          </button>
        </div>

        <Button
          onClick={handleUpload}
          disabled={!file || loading}
          className="h-10 shrink-0"
        >
          {loading ? <Loader2 className="ml-1.5 h-4 w-4 animate-spin" /> : null}
          {loading ? "جارٍ الاستيراد..." : "استيراد"}
        </Button>
      </div>

      {result?.error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="font-medium">{result.error}</span>
        </div>
      )}

      {result && !result.error && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <p className="font-black text-slate-900 dark:text-white text-sm">اكتمل الاستيراد</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 px-3 py-2 text-center">
              <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">{result.created ?? 0}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 font-medium">مرفق جديد</p>
            </div>
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 px-3 py-2 text-center">
              <p className="text-lg font-black text-amber-700 dark:text-amber-400">{result.skipped ?? 0}</p>
              <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">تخطي (موجود)</p>
            </div>
          </div>
          {result.errors && result.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-bold text-red-600 dark:text-red-400">
                {result.errors.length} صف بها أخطاء
              </summary>
              <ul className="mt-2 space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-xs text-red-600 dark:text-red-400">• {e}</li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}
    </div>
  );
}
