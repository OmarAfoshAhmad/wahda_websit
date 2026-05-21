"use client";

/**
 * DentalImportUploader
 * ====================
 * نافذة استيراد مستفيدي شركات الأسنان — مشابهة لـ ImportUploader
 * لكن مع إضافة حقل اختيار شركة التأمين المستهدفة.
 */

import React, { useEffect, useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, Loader2, RefreshCw, Undo2, Building2 } from "lucide-react";
import { Button, Card } from "@/components/ui";

type ImportJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "ROLLED_BACK";

type ImportJobSnapshot = {
  id: string;
  status: ImportJobStatus;
  totalRows: number;
  processedRows: number;
  insertedRows: number;
  duplicateRows: number;
  failedRows: number;
  updatedRows?: number;
  errorMessage: string | null;
  progress: number;
  canRollback?: boolean;
};

type Company = { id: string; name: string; code: string };

interface Props {
  companies: Company[];
}

export function DentalImportUploader({ companies }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ error?: string } | null>(null);
  const [job, setJob] = useState<ImportJobSnapshot | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(companies[0]?.id ?? "");
  const [reactivate, setReactivate] = useState(false);

  useEffect(() => {
    if (!job || (job.status !== "PENDING" && job.status !== "PROCESSING")) return;

    let attempts = 0;
    const MAX_POLL_ATTEMPTS = 300;

    const timer = window.setInterval(async () => {
      attempts++;
      if (attempts >= MAX_POLL_ATTEMPTS) {
        window.clearInterval(timer);
        setJob((prev) => prev ? { ...prev, status: "FAILED" as ImportJobStatus, errorMessage: "انتهت مهلة الاستطلاع" } : prev);
        return;
      }
      try {
        const response = await fetch(`/api/import-jobs/${job.id}`, { method: "GET" });
        if (!response.ok) return;
        const payload = await response.json() as { job: ImportJobSnapshot };
        if (payload?.job) setJob(payload.job);
      } catch { /* تجاهل أخطاء الشبكة العابرة */ }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [job]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !selectedCompanyId) return;
    setUploading(true);
    setResult(null);
    setJob(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("company_id", selectedCompanyId);
      formData.append("reactivate", String(reactivate));
      formData.append("updateBalance", "false");

      const response = await fetch("/api/import-jobs", { method: "POST", body: formData });
      const payload = await response.json() as { error?: string; job?: ImportJobSnapshot };

      if (!response.ok || payload.error || !payload.job) {
        setResult({ error: payload.error ?? "تعذر إنشاء مهمة الاستيراد." });
        return;
      }

      setJob(payload.job);
      fetch(`/api/import-jobs/${payload.job.id}/run`, { method: "POST" })
        .then(async (runResponse) => {
          if (!runResponse.ok) {
            const runPayload = await runResponse.json().catch(() => ({} as { error?: string }));
            throw new Error(runPayload.error ?? "فشل بدء عملية الاستيراد.");
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "فشل بدء عملية الاستيراد.";
          setResult({ error: message });
        });
    } catch {
      setResult({ error: "تعذر رفع الملف أو بدء مهمة الاستيراد." });
    } finally {
      setUploading(false);
    }
  };

  const handleRollback = async () => {
    if (!job || !job.canRollback || rollingBack) return;
    if (!window.confirm("هل أنت متأكد من التراجع عن هذا الاستيراد؟")) return;
    setRollingBack(true);
    try {
      const response = await fetch(`/api/import-jobs/${job.id}/rollback`, { method: "POST" });
      const payload = await response.json() as { error?: string; success?: boolean; deletedCount?: number; restoredCount?: number; revertedCount?: number };
      if (!response.ok || payload.error) {
        setResult({ error: payload.error ?? "فشل التراجع." });
        return;
      }
      setJob((prev) => prev ? {
        ...prev,
        status: "ROLLED_BACK" as ImportJobStatus,
        errorMessage: `تم التراجع: حذف ${payload.deletedCount ?? 0}، إعادة ${payload.restoredCount ?? 0} لحالة الحذف`,
        canRollback: false,
      } : prev);
    } catch {
      setResult({ error: "تعذر الاتصال بالخادم للتراجع." });
    } finally {
      setRollingBack(false);
    }
  };

  const isBusy = uploading || job?.status === "PENDING" || job?.status === "PROCESSING";
  const isCompleted = job?.status === "COMPLETED";
  const isFailed = job?.status === "FAILED";
  const isRolledBack = job?.status === "ROLLED_BACK";
  const hasSkippedRows = Boolean(job && (job.failedRows > 0 || job.duplicateRows > 0));
  const selectedCompany = companies.find(c => c.id === selectedCompanyId);

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <Card className="border border-slate-200 dark:border-slate-800 p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400">
          <FileSpreadsheet className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">استيراد مستفيدي شركة التأمين</h3>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-7 text-slate-500 dark:text-slate-400">
            ارفع ملف Excel يحتوي على <b>card_number</b> و <b>name</b> لمستفيدي الشركة المختارة.
          </p>
        </div>

        {/* اختيار الشركة */}
        <div className="mt-5 w-full max-w-sm mx-auto">
          <label className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 block text-right mb-1.5">
            شركة التأمين المستهدفة
          </label>
          <div className="relative">
            <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-teal-500" />
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              disabled={isBusy}
              className="flex h-11 w-full rounded-md border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 pr-10 pl-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 disabled:opacity-50"
            >
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
          {selectedCompany && (
            <p className="mt-1 text-[11px] text-teal-600 dark:text-teal-400 text-right font-bold">
              ✓ سيتم ربط المستفيدين المستوردين بـ {selectedCompany.name}
            </p>
          )}
        </div>

        <input type="file" id="dental-file-upload" className="hidden" accept=".xlsx,.xls" onChange={handleFileChange} />

        <div className="mx-auto mt-5 flex w-full max-w-sm flex-col items-center space-y-3">
          <label
            htmlFor="dental-file-upload"
            className={`flex h-12 w-full items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors ${
              isBusy ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {file ? file.name : "اختيار الملف (Excel)"}
          </label>

          <div className="w-full space-y-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-right">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">خيارات للمستفيدين الموجودين مسبقاً:</p>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={reactivate}
                onChange={(e) => setReactivate(e.target.checked)}
                disabled={isBusy}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>إعادة تفعيل المستفيدين المعلقين/المكتملين</span>
            </label>
          </div>

          <Button
            className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white"
            disabled={!file || !selectedCompanyId || isBusy}
            onClick={handleUpload}
          >
            {isBusy ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            <span className="mr-2">{isBusy ? "جارٍ الاستيراد..." : "بدء الاستيراد"}</span>
          </Button>
        </div>
      </Card>

      {job && (
        <Card className="border border-slate-200 dark:border-slate-800 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-black text-slate-900 dark:text-white">حالة الاستيراد</h4>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {job.status === "PENDING" && "تم إنشاء المهمة وجارٍ بدء التنفيذ."}
                {job.status === "PROCESSING" && "يمكنك متابعة العمل بينما يستمر الاستيراد في الخلفية."}
                {job.status === "COMPLETED" && "اكتملت المهمة بنجاح."}
                {job.status === "FAILED" && "توقفت المهمة بسبب خطأ."}
                {job.status === "ROLLED_BACK" && "تم التراجع عن هذا الاستيراد بنجاح."}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-black text-slate-700 dark:text-slate-300">
              {job.progress}%
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-teal-500 transition-all" style={{ width: `${job.progress}%` }} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">تمت المعالجة</p>
              <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{job.processedRows}/{job.totalRows}</p>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">تمت الإضافة</p>
              <p className="mt-1 text-lg font-black text-emerald-700 dark:text-emerald-400">{job.insertedRows}</p>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">مكرر</p>
              <p className="mt-1 text-lg font-black text-amber-700 dark:text-amber-400">{job.duplicateRows}</p>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">فشل</p>
              <p className="mt-1 text-lg font-black text-red-700 dark:text-red-400">{job.failedRows}</p>
            </div>
          </div>

          {(isCompleted || isFailed || isRolledBack) && (
            <div className={`mt-4 rounded-md border p-4 ${isRolledBack ? "border-orange-200 bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400" : isCompleted ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : "border-red-200 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black">{isRolledBack ? "تم التراجع" : isCompleted ? "اكتمل الاستيراد" : "فشل الاستيراد"}</p>
                  <p className="mt-1 text-sm">{job.errorMessage ?? (isCompleted ? "تم استيراد المستفيدين وربطهم بالشركة المختارة." : "تحقق من الملف ثم أعد المحاولة.")}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isCompleted && job.canRollback && (
                    <button
                      type="button"
                      onClick={handleRollback}
                      disabled={rollingBack}
                      className="inline-flex h-9 items-center gap-1 rounded-md border border-orange-300 bg-white px-3 text-sm font-bold text-orange-700 hover:bg-orange-50 disabled:opacity-50"
                    >
                      {rollingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                      تراجع
                    </button>
                  )}
                  {(hasSkippedRows || job.insertedRows > 0) && (
                    <a
                      href={`/api/import-jobs/${job.id}/skipped-file`}
                      className="inline-flex h-9 items-center rounded-md border border-current/20 bg-white/70 px-3 text-sm font-bold"
                    >
                      تنزيل التقرير
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setJob(null)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-current/20 bg-white/70"
                    title="إغلاق"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {result?.error && (
        <div className="flex items-center rounded-md border border-red-200 bg-red-50 p-4 text-red-700">
          <AlertCircle className="ml-3 h-5 w-5" />
          <p className="font-medium text-sm">{result.error}</p>
        </div>
      )}
    </div>
  );
}
