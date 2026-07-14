"use client";

import React, { useEffect, useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, Loader2, RefreshCw, Download, Undo2 } from "lucide-react";
import { Button, Card } from "./ui";

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

export function ImportUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ error?: string } | null>(null);
  const [job, setJob] = useState<ImportJobSnapshot | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [updateBalance, setUpdateBalance] = useState(false);
  const [reactivate, setReactivate] = useState(false);

  useEffect(() => {
    if (!job || (job.status !== "PENDING" && job.status !== "PROCESSING")) {
      return;
    }

    let attempts = 0;
    const MAX_POLL_ATTEMPTS = 300; // 300 × 1200ms = 6 دقائق كحد أقصى

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
      } catch {
        // تجاهل أخطاء الشبكة العابرة أثناء الاستطلاع
      }
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
    if (!file) return;
    setUploading(true);
    setResult(null);
    setJob(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("updateBalance", String(updateBalance));
      formData.append("reactivate", String(reactivate));

      const response = await fetch("/api/import-jobs", {
        method: "POST",
        body: formData,
      });

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
            throw new Error(runPayload.error ?? "فشل بدء عملية الاستيراد. حاول مرة أخرى.");
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "فشل بدء عملية الاستيراد. حاول مرة أخرى.";
          setResult({ error: message });
        });
    } catch {
      setResult({ error: "تعذر رفع الملف أو بدء مهمة الاستيراد." });
    } finally {
      setUploading(false);
    }
  };

  const isBusy = uploading || job?.status === "PENDING" || job?.status === "PROCESSING";
  const isCompleted = job?.status === "COMPLETED";
  const isFailed = job?.status === "FAILED";
  const isRolledBack = job?.status === "ROLLED_BACK";
  const hasSkippedRows = Boolean(job && (job.failedRows > 0 || job.duplicateRows > 0));
  const hasUpdates = Boolean(job && job.updatedRows !== undefined && job.updatedRows > 0);

  const handleRollback = async () => {
    if (!job || !job.canRollback || rollingBack) return;
    if (!window.confirm("هل أنت متأكد من التراجع عن هذا الاستيراد؟ سيتم حذف المستفيدين المضافين واستعادة البيانات القديمة.")) return;
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
        errorMessage: `تم التراجع: حذف ${payload.deletedCount ?? 0}، إعادة ${payload.restoredCount ?? 0} لحالة الحذف، استعادة ${payload.revertedCount ?? 0} سجل`,
        canRollback: false,
      } : prev);
    } catch {
      setResult({ error: "تعذر الاتصال بالخادم للتراجع." });
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <Card className="border border-slate-200 dark:border-slate-800 p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-primary dark:text-blue-400">
          <FileSpreadsheet className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">رفع ملف المستفيدين</h3>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-7 text-slate-500 dark:text-slate-400">
            اختر ملف Excel يحتوي على الحقول <b>card_number</b> و <b>name</b> ويمكنه أن يتضمن <b>birth_date</b> أو <b>date_of_birth</b>.
          </p>
          <a
            href="/قالب_استيراد_المستفيدين.xlsx"
            download
            className="mx-auto mt-3 inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Download className="h-3.5 w-3.5" />
            تحميل قالب الاستيراد
          </a>
        </div>
        
        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
        />
        
        <div className="mx-auto mt-5 flex w-full max-w-sm flex-col items-center space-y-3">
          <Button 
            variant="outline" 
            className="h-12 w-full"
            disabled={isBusy}
            onClick={() => document.getElementById("file-upload")?.click()}
          >
            {file ? file.name : "اختيار الملف"}
          </Button>

          {/* خيارات الاستيراد */}
          <div className="w-full space-y-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-right">
            <p className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">خيارات للمستفيدين الموجودين مسبقاً:</p>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={updateBalance}
                onChange={(e) => setUpdateBalance(e.target.checked)}
                disabled={isBusy}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span>تحديث الرصيد (إعادة تعيين الرصيد للقيمة الابتدائية)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={reactivate}
                onChange={(e) => setReactivate(e.target.checked)}
                disabled={isBusy}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span>إعادة تفعيل المستفيدين المعلقين/المكتملين</span>
            </label>
          </div>
          
          <Button 
            className="w-full h-12"
            disabled={!file || isBusy}
            onClick={handleUpload}
          >
            {isBusy ? (
              <Loader2 className="ml-2 h-5 w-5 animate-spin" />
            ) : (
              <Upload className="h-5 w-5" />
            )}
            <span className="mr-2">{isBusy ? "جارٍ رفع الملف وبدء المهمة" : "بدء الاستيراد بالخلفية"}</span>
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
                {job.status === "PROCESSING" && "يمكنك متابعة العمل على الصفحة بينما يستمر الاستيراد في الخلفية."}
                {job.status === "COMPLETED" && "اكتملت المهمة بنجاح."}
                {job.status === "FAILED" && "توقفت المهمة بسبب خطأ ويمكن إعادة المحاولة بملف جديد."}
                {job.status === "ROLLED_BACK" && "تم التراجع عن هذا الاستيراد بنجاح."}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-black text-slate-700 dark:text-slate-300">
              {job.progress}%
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">تمت المعالجة</p>
              <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{job.processedRows}/{job.totalRows}</p>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">تم التحديث</p>
              <p className="mt-1 text-lg font-black text-blue-700 dark:text-blue-400">{job.updatedRows ?? 0}</p>
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
            <div className={`mt-4 rounded-md border p-4 ${isRolledBack ? "border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400" : isCompleted ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400" : "border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black">{isRolledBack ? "تم التراجع" : isCompleted ? "اكتمل الاستيراد" : "فشل الاستيراد"}</p>
                  <p className="mt-1 text-sm">{job.errorMessage ?? (isRolledBack ? "تم التراجع عن جميع تغييرات هذا الاستيراد." : isCompleted ? "تم تحديث البيانات ويمكنك الآن مراجعة المستفيدين." : "تحقق من الملف ثم أعد المحاولة.")}</p>
                  {isCompleted && (hasSkippedRows || hasUpdates) && (
                    <p className="mt-2 text-sm font-medium">
                      {(hasSkippedRows && hasUpdates) 
                        ? "يمكنك متابعة التحديثات عبر الإحصائيات أعلاه، وتنزيل ملف مستقل بالسجلات غير المستوردة."
                        : hasSkippedRows 
                        ? "يمكنك تنزيل ملف مستقل يحتوي على السجلات غير المستوردة وسبب كل حالة."
                        : "تم تحديث السجلات بنجاح (لا توجد سجلات غير مستوردة لتنزيلها)."}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isCompleted && job.canRollback && (
                    <button
                      type="button"
                      onClick={handleRollback}
                      disabled={rollingBack}
                      className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-orange-300 dark:border-orange-700 bg-white dark:bg-black/20 px-3 text-sm font-bold text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/30 disabled:opacity-50"
                    >
                      {rollingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                      تراجع
                    </button>
                  )}
                  {(hasSkippedRows || hasUpdates || job.insertedRows > 0) && (
                    <a
                      href={`/api/import-jobs/${job.id}/skipped-file`}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-current/20 bg-white/70 dark:bg-black/20 px-3 text-sm font-bold"
                    >
                      تنزيل تقرير الاستيراد
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setJob(null)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-current/20 bg-white/70 dark:bg-black/20"
                    title="إخفاء"
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
        <div className="flex items-center rounded-md border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400">
          <AlertCircle className="ml-3 h-5 w-5" />
          <p className="font-medium text-sm">{result.error}</p>
        </div>
      )}
    </div>
  );
}
