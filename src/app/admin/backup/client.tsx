"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { Download, Upload, Loader2, CheckCircle2, AlertTriangle, Database, Shield } from "lucide-react";

type RestoreSummary = {
  users: { added: number; updated: number };
  providers: { added: number; updated: number };
  transactions: { added: number; skipped: number };
  audit_logs: { added: number };
  notifications: { added: number; skipped: number };
};

type RestoreJob = {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  totalSteps: number;
  completedSteps: number;
  currentPhase: string | null;
  errorMessage: string | null;
  summary: RestoreSummary;
};

function phaseLabel(phase: string | null) {
  switch (phase) {
    case "PENDING":
      return "في انتظار البدء";
    case "VALIDATING_BACKUP":
      return "التحقق من سلامة النسخة";
    case "RESTORING_FACILITIES":
      return "استعادة المرافق";
    case "RESTORING_BENEFICIARIES":
      return "استعادة المستفيدين";
    case "RESTORING_TRANSACTIONS":
      return "استعادة الحركات";
    case "RESTORING_AUDIT_LOGS":
      return "استعادة سجلات المراجعة";
    case "RESTORING_NOTIFICATIONS":
      return "استعادة الإشعارات";
    case "COMPLETED":
      return "مكتمل";
    case "FAILED":
      return "فشل";
    default:
      return "جاري المعالجة";
  }
}

function buildSuccessMessage(summary: RestoreSummary) {
  const parts: string[] = [];
  if (summary.users.added > 0) parts.push(`${summary.users.added} مرفق صحي جديد`);
  if (summary.users.updated > 0) parts.push(`${summary.users.updated} مرفق صحي محدّث`);
  if (summary.providers.added > 0) parts.push(`${summary.providers.added} مستفيد جديد`);
  if (summary.providers.updated > 0) parts.push(`${summary.providers.updated} مستفيد محدّث`);
  if (summary.transactions.added > 0) parts.push(`${summary.transactions.added} حركة`);
  if (summary.audit_logs.added > 0) parts.push(`${summary.audit_logs.added} سجل مراجعة`);
  if (summary.notifications.added > 0) parts.push(`${summary.notifications.added} إشعار`);

  const total =
    summary.users.added +
    summary.users.updated +
    summary.providers.added +
    summary.providers.updated +
    summary.transactions.added +
    summary.audit_logs.added +
    summary.notifications.added;

  if (total === 0) {
    return "اكتملت الاستعادة: جميع البيانات موجودة مسبقاً — لم تتم إضافة سجلات جديدة";
  }

  return `اكتملت الاستعادة بنجاح: ${parts.join("، ")}`;
}

function isCancelMessage(message: string | null | undefined) {
  return typeof message === "string" && message.includes("إلغاء مهمة الاستعادة");
}

export function BackupClient() {
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [includeSensitive, setIncludeSensitive] = useState(true);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoreJob, setRestoreJob] = useState<RestoreJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseErrorFromResponse = async (res: Response, fallback: string) => {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await res.json().catch(() => null);
      return data?.error || fallback;
    }
    const text = await res.text().catch(() => "");
    return text || fallback;
  };

  const handleExport = async () => {
    setExportLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/backup/export?sensitive=${includeSensitive ? "true" : "false"}`);
      if (!res.ok) {
        const message = await parseErrorFromResponse(res, "تعذر تحميل النسخة الاحتياطية");
        throw new Error(message);
      }

      const blob = await res.blob();
      // تنظيف اسم الملف من الممكن أن يحتوي على أحرف خبيثة
      const disposition = res.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      let filename = filenameMatch?.[1] || `wahda-backup-${new Date().toISOString().slice(0, 10)}.wbk`;
      // إزالة أي أحرف مسار أو أحرف خطرة
      filename = filename.replace(/[/\\<>:"|?*]/g, "_").replace(/\.\./g, "");
      if (!filename.endsWith(".wbk")) filename += ".wbk";

      const safeBlob = new Blob([blob], { type: "application/octet-stream" });
      const url = URL.createObjectURL(safeBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setResult({ type: "success", message: "تم تحميل النسخة الاحتياطية بنجاح" });
    } catch (error) {
      setResult({ type: "error", message: error instanceof Error ? error.message : "خطأ غير متوقع" });
    } finally {
      setExportLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".wbk")) {
      setResult({ type: "error", message: "يجب أن يكون الملف بصيغة WBK" });
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setResult({ type: "error", message: "حجم الملف كبير جداً (الحد الأقصى 100MB)" });
      return;
    }

    setSelectedFile(file);
    setConfirmRestore(true);
    setResult(null);
  };

  const handleRestore = async () => {
    if (!selectedFile) return;

    setImportLoading(true);
    setResult(null);
    setConfirmRestore(false);
    let started = false;

    try {
      const buffer = await selectedFile.arrayBuffer();

      const res = await fetch("/api/backup/restore-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
      });

      if (!res.ok) {
        const message = await parseErrorFromResponse(res, "تعذرت استعادة النسخة الاحتياطية");
        throw new Error(message);
      }

      const data = await res.json();
      const job = data?.job as RestoreJob | undefined;
      if (!job) {
        throw new Error("تعذر بدء مهمة الاستعادة الخلفية");
      }

      setRestoreJob(job);
      started = true;
      setResult({ type: "success", message: "بدأت الاستعادة بالخلفية. يمكنك متابعة العمل أثناء التنفيذ." });
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        setResult({ type: "error", message: "فشل الاتصال بالخادم (Network). تحقق من أن الخدمة تعمل ومن إعداد HTTPS/Proxy." });
      } else {
        setResult({ type: "error", message: error instanceof Error ? error.message : "خطأ غير متوقع" });
      }
    } finally {
      if (!started) {
        setImportLoading(false);
      }
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setRestoreText("");
    }
  };

  const cancelRestore = () => {
    setConfirmRestore(false);
    setRestoreText("");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCancelRunningRestore = async () => {
    if (!restoreJob) return;
    const yes = window.confirm("هل تريد إلغاء عملية الاستعادة الحالية؟");
    if (!yes) return;

    setCancelLoading(true);
    try {
      const res = await fetch(`/api/backup/restore-jobs/${restoreJob.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });

      if (!res.ok) {
        const message = await parseErrorFromResponse(res, "تعذر إلغاء مهمة الاستعادة");
        throw new Error(message);
      }

      const data = await res.json();
      const job = data?.job as RestoreJob | undefined;
      if (job) setRestoreJob(job);

      setImportLoading(false);
      setResult({ type: "success", message: "تم إرسال أمر الإلغاء وسيتم إيقاف الاستعادة." });
    } catch (error) {
      setResult({ type: "error", message: error instanceof Error ? error.message : "تعذر إلغاء مهمة الاستعادة" });
    } finally {
      setCancelLoading(false);
    }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (!restoreJob) return;
      if (restoreJob.status === "COMPLETED" || restoreJob.status === "FAILED") return;

      try {
        const res = await fetch(`/api/backup/restore-jobs/${restoreJob.id}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          const msg = await parseErrorFromResponse(res, "تعذر قراءة تقدم الاستعادة");
          throw new Error(msg);
        }

        const data = await res.json();
        const nextJob = data?.job as RestoreJob | undefined;
        if (!nextJob) throw new Error("تعذر قراءة حالة المهمة");

        setRestoreJob(nextJob);

        if (nextJob.status === "COMPLETED") {
          setImportLoading(false);
          setResult({ type: "success", message: buildSuccessMessage(nextJob.summary) });
          return;
        }

        if (nextJob.status === "FAILED") {
          setImportLoading(false);
          if (isCancelMessage(nextJob.errorMessage)) {
            setResult({ type: "success", message: nextJob.errorMessage || "تم إلغاء مهمة الاستعادة." });
          } else {
            setResult({ type: "error", message: nextJob.errorMessage || "فشلت الاستعادة" });
          }
          return;
        }
      } catch (error) {
        setImportLoading(false);
        setResult({ type: "error", message: error instanceof Error ? error.message : "تعذر متابعة تقدم الاستعادة" });
        return;
      }

      timer = setTimeout(poll, 1500);
    }

    poll();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [restoreJob]);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestJob() {
      try {
        const res = await fetch("/api/backup/restore-jobs", { cache: "no-store" });
        if (!res.ok) return;

        const data = await res.json();
        const latest = data?.job as RestoreJob | null | undefined;
        if (!latest || cancelled) return;

        setRestoreJob(latest);

        if (latest.status === "PROCESSING" || latest.status === "PENDING") {
          setImportLoading(true);
          setResult({ type: "success", message: "توجد عملية استعادة قيد التنفيذ بالخلفية." });
        } else if (latest.status === "COMPLETED") {
          setResult({ type: "success", message: buildSuccessMessage(latest.summary) });
        } else if (latest.status === "FAILED") {
          if (isCancelMessage(latest.errorMessage)) {
            setResult({ type: "success", message: latest.errorMessage || "تم إلغاء مهمة الاستعادة." });
          } else {
            setResult({ type: "error", message: latest.errorMessage || "آخر عملية استعادة فشلت" });
          }
        }
      } catch {
        // تجاهل أخطاء التحميل الأولي لتفادي إزعاج المستخدم.
      }
    }

    loadLatestJob();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title text-2xl font-black text-slate-950">النسخ الاحتياطي</h1>
        <p className="mt-1.5 text-sm text-slate-600">تحميل نسخة احتياطية من البيانات أو استعادة نسخة محفوظة.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* تصدير */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-primary dark:text-blue-400">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">تحميل نسخة احتياطية</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">تنزيل جميع البيانات كملف JSON على جهازك</p>
            </div>
          </div>

          <div className="mb-4 rounded-md border border-sky-200 dark:border-sky-900/50 bg-sky-50 dark:bg-sky-900/20 p-3">
            <p className="text-xs font-bold text-sky-700 dark:text-sky-400">
              الملف الناتج مشفّر بصيغة WBK (AES-256 + GZIP).
              يشمل users, providers, transactions, notifications, audit_logs.
              لا يتم تصدير كلمات المرور ويمكنك اختيار تضمين PIN hash.
            </p>
          </div>

          <label className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-sm font-bold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeSensitive}
              onChange={(e) => setIncludeSensitive(e.target.checked)}
              className="h-4 w-4"
            />
            تضمين PIN hash (بيانات حساسة)
          </label>

          <Button onClick={handleExport} disabled={exportLoading} className="w-full gap-2">
            {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportLoading ? "جاري التحميل..." : "تحميل النسخة الاحتياطية"}
          </Button>
        </Card>

        {/* استعادة */}
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">استعادة نسخة احتياطية</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">رفع ملف نسخة احتياطية لاستعادة البيانات</p>
            </div>
          </div>

          <div className="mb-4 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-3">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-400">
              الاستعادة تعمل بالخلفية وتضيف البيانات غير الموجودة فقط — لا تحذف أو تستبدل أي بيانات حالية.
              المرافق المُستعادة ستحتاج لإعادة تعيين كلمة المرور.
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".wbk"
            className="hidden"
            onChange={handleFileSelect}
          />

          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importLoading}
            className="w-full gap-2"
          >
            {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importLoading ? "جاري الاستعادة..." : "اختيار ملف النسخة الاحتياطية"}
          </Button>
        </Card>
      </div>

      {restoreJob && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">تقدم الاستعادة</h3>
            <div className="flex items-center gap-2">
              {(restoreJob.status === "PENDING" || restoreJob.status === "PROCESSING") && (
                <Button
                  variant="outline"
                  onClick={handleCancelRunningRestore}
                  disabled={cancelLoading}
                  className="h-8 px-3 text-xs"
                >
                  {cancelLoading ? "جاري الإلغاء..." : "إلغاء الاستعادة"}
                </Button>
              )}
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                {restoreJob.progress}% ({restoreJob.completedSteps}/{restoreJob.totalSteps || 0})
              </span>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, restoreJob.progress))}%` }}
            />
          </div>

          <p className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-400">
            المرحلة الحالية: {phaseLabel(restoreJob.currentPhase)}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 flex items-center justify-between">
              <span>مرافق مضافة:</span> <span>{restoreJob.summary.users.added}</span>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 flex items-center justify-between">
              <span>مرافق محدثة:</span> <span>{restoreJob.summary.users.updated}</span>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 flex items-center justify-between">
              <span>مستفيدون مضافون:</span> <span>{restoreJob.summary.providers.added}</span>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 flex items-center justify-between">
              <span>مستفيدون محدثون:</span> <span>{restoreJob.summary.providers.updated}</span>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 flex items-center justify-between">
              <span>حركات مضافة:</span> <span>{restoreJob.summary.transactions.added}</span>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 flex items-center justify-between">
              <span>حركات متخطاة:</span> <span>{restoreJob.summary.transactions.skipped}</span>
            </div>
          </div>
        </Card>
      )}

      {/* رسالة النتيجة */}
      {result && (
        <Card className={`p-4 ${result.type === "success" ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20" : "border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20"}`}>
          <div className="flex items-center gap-2">
            {result.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            )}
            <p className={`text-sm font-bold ${result.type === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
              {result.message}
            </p>
          </div>
        </Card>
      )}

      {/* تأكيد الاستعادة */}
      {confirmRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-black text-slate-900 dark:text-white">تأكيد الاستعادة</h3>
            </div>

            <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">
              هل أنت متأكد من استعادة النسخة الاحتياطية من الملف:
            </p>
            <p className="mb-4 rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-bold text-slate-800 dark:text-slate-200" dir="ltr">
              {selectedFile?.name}
            </p>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              سيتم إضافة البيانات غير الموجودة فقط. لن يتم حذف أو تعديل أي بيانات حالية.
            </p>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-black text-slate-500 dark:text-slate-400">للتأكيد اكتب: RESTORE</label>
              <input
                value={restoreText}
                onChange={(e) => setRestoreText(e.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                placeholder="RESTORE"
                dir="ltr"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={cancelRestore}>
                إلغاء
              </Button>
              <Button className="flex-1" onClick={handleRestore} disabled={restoreText !== "RESTORE"}>
                تأكيد الاستعادة
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
