"use client";

import React, { useEffect, useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Download, RotateCcw, RefreshCw } from "lucide-react";
import { Button, Card } from "./ui";

type TransactionImportJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

type TransactionImportSummary = {
  auditLogId: string;
  importMode: "replace_old_imports" | "incremental_update";
  totalRows: number;
  duplicateCardCount: number;
  importedFamilies: number;
  importedTransactions: number;
  updatedFamilies: number;
  updatedTransactions: number;
  suspendedFamilies: number;
  balanceSetFamilies: number;
  skippedNotFound: number;
  cleanupDeletedImportTransactions: number;
  cleanupTouchedBeneficiaries: number;
  autoDebtAffectedDebtors: number;
  autoDebtSettledDebtors: number;
  autoDebtUnresolvedDebtors: number;
};

type TransactionImportJobSnapshot = {
  id: string;
  status: TransactionImportJobStatus;
  totalRows: number;
  processedRows: number;
  progress: number;
  errorMessage: string | null;
  message: string | null;
  result: TransactionImportSummary | null;
};

const ACTIVE_TX_IMPORT_JOB_KEY = "active_tx_import_job_id";

export function TransactionImportUploader({
  currentActorName,
}: {
  currentActorName: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [replaceOldImports, setReplaceOldImports] = useState(true);
  const [job, setJob] = useState<TransactionImportJobSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);

  useEffect(() => {
    const storedJobId = window.localStorage.getItem(ACTIVE_TX_IMPORT_JOB_KEY);
    if (!storedJobId || job) return;

    void fetch(`/api/import-transactions/jobs/${storedJobId}`, { method: "GET" })
      .then(async (response) => {
        if (!response.ok) {
          window.localStorage.removeItem(ACTIVE_TX_IMPORT_JOB_KEY);
          return;
        }
        const payload = await response.json() as { job?: TransactionImportJobSnapshot };
        if (payload.job) setJob(payload.job);
      })
      .catch(() => {
        // تجاهل أخطاء الشبكة الأولية
      });
  }, [job]);

  useEffect(() => {
    if (!job || (job.status !== "PENDING" && job.status !== "PROCESSING")) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/import-transactions/jobs/${job.id}`, { method: "GET" });
        if (!response.ok) return;
        const payload = await response.json() as { job?: TransactionImportJobSnapshot };
        if (!payload.job) return;

        setJob(payload.job);

        if (payload.job.status !== "PENDING" && payload.job.status !== "PROCESSING") {
          window.localStorage.removeItem(ACTIVE_TX_IMPORT_JOB_KEY);
        }
      } catch {
        // تجاهل انقطاع الشبكة المؤقت
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [job]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setJob(null);
    setError(null);
    setRollbackMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("replace_old_imports", replaceOldImports ? "true" : "false");

      const response = await fetch("/api/import-transactions/jobs", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json() as { error?: string; job?: TransactionImportJobSnapshot };

      if (!response.ok || payload.error || !payload.job) {
        setError(payload.error ?? "تعذر إنشاء مهمة الاستيراد.");
        return;
      }

      setJob(payload.job);
      window.localStorage.setItem(ACTIVE_TX_IMPORT_JOB_KEY, payload.job.id);

      fetch(`/api/import-transactions/jobs/${payload.job.id}/run`, { method: "POST" })
        .then(async (runResponse) => {
          if (!runResponse.ok) {
            const runPayload = await runResponse.json().catch(() => ({} as { error?: string }));
            throw new Error(runPayload.error ?? "فشل بدء مهمة الاستيراد في الخلفية.");
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "فشل بدء مهمة الاستيراد في الخلفية.";
          setError(message);
        });
    } catch {
      setError("تعذر رفع الملف. تحقق من الاتصال وأعد المحاولة.");
    } finally {
      setUploading(false);
    }
  };

  const handleRollbackImport = async (auditLogId: string) => {
    if (!auditLogId || rollingBack) return;
    setRollingBack(true);
    setRollbackMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/import-transactions/rollback/${auditLogId}`, {
        method: "POST",
      });
      const payload = await response.json() as { error?: string; result?: { rollbackAuditId?: string } };

      if (!response.ok || payload.error) {
        setError(payload.error ?? "فشل تنفيذ التراجع عن الاستيراد.");
        return;
      }

      const rollbackAuditId = payload.result?.rollbackAuditId;
      setRollbackMessage(
        rollbackAuditId
          ? `تم التراجع بنجاح. رقم سجل التراجع: ${rollbackAuditId}`
          : "تم التراجع بنجاح.",
      );

      setJob((prev) => prev ? {
        ...prev,
        result: prev.result ? { ...prev.result, auditLogId: prev.result.auditLogId } : prev.result,
      } : prev);
    } catch {
      setError("حدث خطأ أثناء التراجع عن الاستيراد.");
    } finally {
      setRollingBack(false);
    }
  };

  const isBusy = uploading || job?.status === "PENDING" || job?.status === "PROCESSING";
  const isCompleted = job?.status === "COMPLETED";
  const isFailed = job?.status === "FAILED";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card className="border border-slate-200 dark:border-slate-800 p-6 text-center sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-primary dark:text-blue-400">
          <FileSpreadsheet className="h-7 w-7" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">رفع ملف الحركات المجمعة</h3>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-7 text-slate-500 dark:text-slate-400">
            اختر ملف Excel يحتوي على حقول <b>رقم البطاقة</b> و<b>الاسم</b> و<b>عدد الافراد</b> و<b>الرصيد الكلي</b> و<b>الرصيد المستخدم</b>.
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-6 text-amber-700 dark:text-amber-300">
            ملاحظة: الرصيد المستخدم يتم اعتماده كعدد صحيح فقط (يتم حذف الجزء العشري تلقائياً أثناء الاستيراد).
          </p>
          <a
            href="/قالب_استيراد_الحركات_المجمعة.xlsx"
            download
            className="mx-auto mt-3 inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Download className="h-3.5 w-3.5" />
            تحميل قالب الاستيراد
          </a>
        </div>

        <input
          type="file"
          id="tx-file-upload"
          className="hidden"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
        />

        <div className="mx-auto mt-5 flex w-full max-w-sm flex-col items-center space-y-3">
          <div className="h-12 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-3 text-sm text-slate-700 dark:text-slate-300 flex items-center justify-center">
            سيتم تنفيذ الاستيراد باسم: <span className="mr-1 font-black">{currentActorName}</span>
          </div>

          <Button
            variant="outline"
            className="h-12 w-full"
            disabled={isBusy}
            onClick={() => document.getElementById("tx-file-upload")?.click()}
          >
            {file ? file.name : "اختيار الملف"}
          </Button>

          <label className="flex w-full items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-right">
            <input
              type="checkbox"
              checked={replaceOldImports}
              onChange={(e) => setReplaceOldImports(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0"
            />
            <span className="text-xs leading-6 text-amber-800 dark:text-amber-300">
              استبدال كامل للاستيرادات السابقة لنفس البطاقات في الملف (إلغاء IMPORT القديمة ثم إعادة الحساب). هذا الخيار يمنع التكرار وهو الوضع الموصى به.
            </span>
          </label>

          <Button
            className="w-full h-12"
            disabled={!file || isBusy}
            onClick={handleUpload}
          >
            {isBusy ? (
              <><Loader2 className="ml-2 h-5 w-5 animate-spin" /><span className="mr-2">جارٍ بدء/تنفيذ المهمة…</span></>
            ) : (
              <><Upload className="h-5 w-5" /><span className="mr-2">بدء الاستيراد بالخلفية</span></>
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

      {job && (
        <Card className="border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-black text-slate-900 dark:text-white">حالة استيراد الحركات</h4>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {job.status === "PENDING" && "تم إنشاء المهمة وجارٍ بدء التنفيذ."}
                {job.status === "PROCESSING" && "المهمة تعمل بالخلفية ويمكنك تحديث الصفحة بأمان."}
                {job.status === "COMPLETED" && "اكتملت المهمة بنجاح."}
                {job.status === "FAILED" && "توقفت المهمة بسبب خطأ."}
              </p>
              {job.message && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{job.message}</p>
              )}
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-black text-slate-700 dark:text-slate-300">
              {job.progress}%
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} />
          </div>

          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-300">
            تمت المعالجة: <b>{job.processedRows.toLocaleString("ar-LY")}</b> / <b>{job.totalRows.toLocaleString("ar-LY")}</b>
          </div>

          {isCompleted && job.result && (
            <>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <h4 className="text-base font-black text-slate-900 dark:text-white">ملخص نتيجة الاستيراد</h4>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatBox label="وضع الاستيراد" value={job.result.importMode === "replace_old_imports" ? "إحلال كامل" : "تحديث تراكمي"} color={job.result.importMode === "replace_old_imports" ? "emerald" : "amber"} />
                <StatBox label="حركات IMPORT حُذفت فعلياً" value={job.result.cleanupDeletedImportTransactions} color="emerald" />
                <StatBox label="مستفيدون أُعيد ضبطهم" value={job.result.cleanupTouchedBeneficiaries} color="emerald" />
                <StatBox label="إجمالي الصفوف" value={job.result.totalRows} />
                <StatBox label="بطاقات مكررة (تم دمجها)" value={job.result.duplicateCardCount} color="amber" />
                <StatBox label="غير موجودين" value={job.result.skippedNotFound} color="red" />
                <StatBox label="أسر جديدة" value={job.result.importedFamilies} color="emerald" />
                <StatBox label="حركات جديدة" value={job.result.importedTransactions} color="emerald" />
                <StatBox label="أسر تم تحديثها" value={job.result.updatedFamilies} color="amber" />
                <StatBox label="حركات محدَّثة" value={job.result.updatedTransactions} color="amber" />
                <StatBox label="أسر انتهى رصيدها" value={job.result.suspendedFamilies} color="amber" />
                <StatBox label="أسر بدون استخدام" value={job.result.balanceSetFamilies} color="emerald" />
                <StatBox label="حالات مديونية مكتشفة" value={job.result.autoDebtAffectedDebtors} color="red" />
                <StatBox label="مديونية تم تسويتها" value={job.result.autoDebtSettledDebtors} color="emerald" />
                <StatBox label="مديونية متبقية" value={job.result.autoDebtUnresolvedDebtors} color="amber" />
              </div>

              {job.result.autoDebtAffectedDebtors > 0 && (
                <div className="rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-800 dark:text-blue-300">
                  تم تشغيل تسوية المديونية تلقائياً بعد الاستيراد. يمكنك مراجعة المتبقي من نافذة المديونية في صفحة التكرارات.
                </div>
              )}

              <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    يمكنك التراجع عن هذه الدفعة بدقة مع استرجاع حركات IMPORT القديمة والأرصدة كما كانت قبل الاستيراد.
                  </p>
                  <Button
                    variant="outline"
                    className="h-9 border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900"
                    onClick={() => handleRollbackImport(job.result!.auditLogId)}
                    disabled={rollingBack}
                  >
                    {rollingBack ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    <span className="mr-1.5">تراجع عن هذه العملية</span>
                  </Button>
                </div>
                {rollbackMessage && (
                  <p className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">{rollbackMessage}</p>
                )}
              </div>
            </>
          )}

          {(isCompleted || isFailed) && (
            <div className={`rounded-md border p-4 ${isCompleted ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400" : "border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black">{isCompleted ? "اكتمل الاستيراد" : "فشل الاستيراد"}</p>
                  <p className="mt-1 text-sm">{job.errorMessage ?? (isCompleted ? "اكتملت المهمة ويمكنك مراجعة النتائج." : "تحقق من الملف ثم أعد المحاولة.")}</p>
                </div>
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
  value: number | string;
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
      <p className={`mt-1 text-lg font-black ${colorMap[color]}`}>{typeof value === "number" ? value.toLocaleString("ar-LY") : value}</p>
    </div>
  );
}
