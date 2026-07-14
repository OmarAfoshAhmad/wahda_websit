"use client";

import React, { useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, Loader2, CheckCircle2, Trash2, Check, X, ShieldAlert, CalendarClock } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { importPhysiotherapyTransactionsAction, type SkippedRowDetail, type SummaryGroup } from "@/app/actions/import-physiotherapy-transactions";
import Link from "next/link";

interface CompanyOption {
  id: string;
  name: string;
}

export function PhysiotherapyTransactionImportUploader({
  companies,
  initialCompanyId,
}: {
  companies: CompanyOption[];
  initialCompanyId?: string;
}) {
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId || "");
  const [operationMode, setOperationMode] = useState<"import" | "update_dates">("import");
  const [file, setFile] = useState<File | null>(null);
  const [purgeOld, setPurgeOld] = useState(false);
  const [autoCreateMissing, setAutoCreateMissing] = useState(true);
  const [autoCreateMissingFacilities, setAutoCreateMissingFacilities] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);

  // Analysis result (Dry run)
  const [analysis, setAnalysis] = useState<{
    success: boolean;
    error?: string;
    totalRows: number;
    insertedCount: number;
    skippedCount: number;
    autoCreatedCount: number;
    autoCreatedFacilitiesCount: number;
    ceilingExceededCount?: number;
    ceilingExceededDetails?: SkippedRowDetail[];
    skippedDetails: SkippedRowDetail[];
    groups: SummaryGroup[];
    operationMode?: "import" | "update_dates";
    updatedCount?: number;
    alreadyCorrectCount?: number;
    missingExistingCount?: number;
    conflictCount?: number;
  } | null>(null);

  // Final result (Commit run)
  const [result, setResult] = useState<{
    success: boolean;
    error?: string;
    totalRows: number;
    insertedCount: number;
    skippedCount: number;
    autoCreatedCount: number;
    autoCreatedFacilitiesCount: number;
    ceilingExceededCount?: number;
    ceilingExceededDetails?: SkippedRowDetail[];
    skippedDetails: SkippedRowDetail[];
    operationMode?: "import" | "update_dates";
    updatedCount?: number;
    alreadyCorrectCount?: number;
    missingExistingCount?: number;
    conflictCount?: number;
  } | null>(null);

  // File base64 cached for commit run
  const [fileBase64, setFileBase64] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setAnalysis(null);
      setResult(null);
      setFileBase64(null);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;

    setAnalyzing(true);
    setAnalysis(null);
    setResult(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result?.toString().split(",")[1];
        if (!base64) {
          setAnalysis({
            success: false,
            error: "فشل قراءة الملف كـ Base64.",
            totalRows: 0,
            insertedCount: 0,
            skippedCount: 0,
            autoCreatedCount: 0,
            autoCreatedFacilitiesCount: 0,
            skippedDetails: [],
            groups: [],
          });
          setAnalyzing(false);
          return;
        }

        setFileBase64(base64);

        // Run dry-run scan
        const res = await importPhysiotherapyTransactionsAction(
          base64,
          operationMode === "import" ? purgeOld : false,
          true,
          selectedCompanyId,
          operationMode === "import" ? autoCreateMissing : false,
          operationMode === "import" ? autoCreateMissingFacilities : false,
          false,
          operationMode === "update_dates",
          file.name,
        );
        setAnalysis(res);
        setAnalyzing(false);
      };

      reader.onerror = () => {
        setAnalysis({
          success: false,
          error: "فشل قراءة ملف Excel.",
          totalRows: 0,
          insertedCount: 0,
          skippedCount: 0,
          autoCreatedCount: 0,
          autoCreatedFacilitiesCount: 0,
          skippedDetails: [],
          groups: [],
        });
        setAnalyzing(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setAnalysis({
        success: false,
        error: err.message || "حدث خطأ أثناء فحص وتحليل الملف.",
        totalRows: 0,
        insertedCount: 0,
        skippedCount: 0,
        autoCreatedCount: 0,
        autoCreatedFacilitiesCount: 0,
        skippedDetails: [],
        groups: [],
      });
      setAnalyzing(false);
    }
  };

  const handleCommitImport = async () => {
    if (!fileBase64) return;

    setImporting(true);
    setResult(null);

    try {
      const res = await importPhysiotherapyTransactionsAction(
        fileBase64,
        operationMode === "import" ? purgeOld : false,
        false,
        selectedCompanyId,
        operationMode === "import" ? autoCreateMissing : false,
        operationMode === "import" ? autoCreateMissingFacilities : false,
        false,
        operationMode === "update_dates",
        file?.name,
      );
      setResult(res);
      setImporting(false);
    } catch (err: any) {
      setResult({
        success: false,
        error: err.message || "حدث خطأ أثناء إتمام عملية الاستيراد الفعلي.",
        totalRows: 0,
        insertedCount: 0,
        skippedCount: 0,
        autoCreatedCount: 0,
        autoCreatedFacilitiesCount: 0,
        skippedDetails: [],
      });
      setImporting(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setAnalysis(null);
    setResult(null);
    setPurgeOld(false);
    setAutoCreateMissing(true);
    setAutoCreateMissingFacilities(true);
    setOperationMode("import");
  };

  const isDateUpdate = operationMode === "update_dates";
  const analysisReadyCount = analysis?.updatedCount ?? analysis?.insertedCount ?? 0;
  const dateUpdateHasBlockingIssues = isDateUpdate && (
    (analysis?.missingExistingCount ?? 0) > 0 || (analysis?.conflictCount ?? 0) > 0
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Step 1: Upload and Configure */}
      {!analysis && !result && (
        <Card className="p-6">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
            <FileSpreadsheet className="h-6 w-6 text-teal-600 dark:text-teal-400" />
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">تحميل وتحليل ملف حركات العلاج الطبيعي</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                يقوم النظام بالتحقق التلقائي من مطابقة أسماء العيادات والمستفيدين والشركات قبل الحفظ الفعلي.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Company Selector */}
            {initialCompanyId ? (
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">شركة التأمين المستهدفة</label>
                <div className="flex h-10 w-full items-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm font-black text-teal-700 dark:text-teal-400">
                  {companies.find((c) => c.id === selectedCompanyId)?.name || selectedCompanyId}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">اختر شركة التأمين المستهدفة</label>
                <select
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                  disabled={analyzing}
                  className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                >
                  <option value="">اختر شركة التأمين...</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">نوع العملية</label>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setOperationMode("import")}
                  disabled={analyzing}
                  className={`rounded-lg border p-4 text-right transition-colors ${operationMode === "import" ? "border-teal-500 bg-teal-50 dark:bg-teal-950/20" : "border-slate-200 dark:border-slate-700"}`}
                >
                  <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                    <Upload className="h-4 w-4 text-teal-600" />
                    استيراد حركات جديدة
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">ينشئ الحركات ويحسب عدد الجلسات فقط، دون تطبيق مبالغ أو نسب تغطية مالية.</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOperationMode("update_dates");
                    setPurgeOld(false);
                  }}
                  disabled={analyzing}
                  className={`rounded-lg border p-4 text-right transition-colors ${operationMode === "update_dates" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20" : "border-slate-200 dark:border-slate-700"}`}
                >
                  <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
                    <CalendarClock className="h-4 w-4 text-blue-600" />
                    تحديث تواريخ حركات موجودة
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">يغيّر التاريخ فقط، دون إنشاء حركة أو خصم أو إعادة حساب السقف.</p>
                </button>
              </div>
            </div>

            {operationMode === "update_dates" && (
              <Card className="border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
                <div className="flex gap-3">
                  <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                  <div>
                    <p className="text-sm font-black text-blue-900 dark:text-blue-200">وضع تصحيح التاريخ الآمن</p>
                    <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-400">
                      يجب أن يكون الملف نسخة مصححة من ملف الشركة الذي استُورد سابقاً مع بقاء ترتيب الصفوف والبطاقات والمبالغ كما هي.
                      ستتوقف العملية كاملة إذا وُجدت حركة مفقودة أو متعارضة.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* File Picker */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">ملف حركات العلاج الطبيعي (.xlsx)</label>
              <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 flex flex-col items-center justify-center bg-slate-50/50 dark:bg-slate-950/20 hover:bg-slate-50 dark:hover:bg-slate-950/30 transition-all">
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={handleFileChange}
                  disabled={analyzing}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Upload className="h-10 w-10 text-slate-400 mb-3" />
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  {file ? file.name : "اضغط هنا لاختيار ملف الإكسل"}
                </span>
                <span className="text-xs text-slate-400 mt-1">
                  {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "صيغة .xlsx فقط بحد أقصى 10 ميجابايت"}
                </span>
              </div>
            </div>

            {/* Auto Create Missing Option */}
            {operationMode === "import" && <Card className="p-4 border-teal-200 bg-teal-50/20 dark:border-teal-900/30">
              <div className="flex items-start gap-3">
                <input
                  id="autoCreateMissing"
                  type="checkbox"
                  checked={autoCreateMissing}
                  onChange={(e) => setAutoCreateMissing(e.target.checked)}
                  disabled={analyzing}
                  className="mt-1 h-4.5 w-4.5 text-teal-600 focus:ring-teal-500 border-slate-300 rounded"
                />
                <div className="space-y-1">
                  <label htmlFor="autoCreateMissing" className="text-sm font-black text-slate-800 dark:text-white cursor-pointer select-none">
                    إنشاء المستفيدين الجدد غير المسجلين تلقائياً
                  </label>
                  <p className="text-xs text-slate-500">
                    إذا تم تفعيل هذا الخيار (موصى به)، سيقوم النظام بإنشاء بطاقة تابعة جديدة تلقائياً إذا كانت البطاقة بالملف غير مسجلة بالنظام (مثل بطاقات الزوجة W أو الأبناء S).
                  </p>
                </div>
              </div>
            </Card>}

            {/* Auto Create Missing Facilities Option */}
            {operationMode === "import" && <Card className="p-4 border-indigo-200 bg-indigo-50/20 dark:border-indigo-900/30">
              <div className="flex items-start gap-3">
                <input
                  id="autoCreateMissingFacilities"
                  type="checkbox"
                  checked={autoCreateMissingFacilities}
                  onChange={(e) => setAutoCreateMissingFacilities(e.target.checked)}
                  disabled={analyzing}
                  className="mt-1 h-4.5 w-4.5 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                />
                <div className="space-y-1">
                  <label htmlFor="autoCreateMissingFacilities" className="text-sm font-black text-slate-800 dark:text-white cursor-pointer select-none">
                    إنشاء المرافق (العيادات) غير الموجودة تلقائياً
                  </label>
                  <p className="text-xs text-slate-500">
                    عند تفعيل هذا الخيار، سيقوم النظام تلقائياً بإنشاء أي مرفق موجود في الملف وغير مسجل في المنظومة، مع منع التكرار وإعطائه كلمة مرور افتراضية (123456). يمكنك لاحقاً تعديل بياناته من إدارة المرافق.
                  </p>
                </div>
              </div>
            </Card>}

            {/* Purge Old Option */}
            {operationMode === "import" && <Card className="p-4 border-amber-200 bg-amber-50/20 dark:border-amber-900/30">
              <div className="flex items-start gap-3">
                <input
                  id="purgeOld"
                  type="checkbox"
                  checked={purgeOld}
                  onChange={(e) => setPurgeOld(e.target.checked)}
                  disabled={analyzing}
                  className="mt-1 h-4.5 w-4.5 text-amber-600 focus:ring-amber-500 border-slate-300 rounded"
                />
                <div className="space-y-1">
                  <label htmlFor="purgeOld" className="text-sm font-black text-slate-800 dark:text-white cursor-pointer select-none">
                    مسح جميع حركات العلاج الطبيعي السابقة الخاصة بهذه الشركة فقط قبل الاستيراد
                  </label>
                  <p className="text-xs text-slate-500">
                    إذا قمت بتفعيل هذا الخيار، سيتم حذف كل الحركات المسجلة لعيادات العلاج الطبيعي (`PHYSIOTHERAPY`) الخاصة بالشركة المحددة في المنظومة قبل حفظ الحركات المرفوعة حديثاً.
                  </p>
                </div>
              </div>
            </Card>}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Link href="/admin/physiotherapy-transactions">
                <Button variant="outline" type="button" disabled={analyzing}>
                  إلغاء
                </Button>
              </Link>
              <Button
                onClick={handleAnalyze}
                disabled={!file || !selectedCompanyId || analyzing}
                className="bg-teal-600 hover:bg-teal-700 text-white min-w-[140px]"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    جاري التحليل والمطابقة...
                  </>
                ) : (
                  "تحليل الملف والمطابقة"
                )}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step 2: Analysis Preview screen */}
      {analysis && !result && (
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">نتائج تحليل ومطابقة الملف المرفوع</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isDateUpdate
                    ? "تمت مطابقة كل صف بالحركة المستوردة سابقاً. لن تتغير المبالغ أو الأرصدة."
                    : "تم تجميع البيانات ومطابقتها للتأكد من دقة الأسماء والمرافق قبل إتمام الحفظ."}
                </p>
              </div>
              <Button variant="outline" onClick={resetAll} disabled={importing}>
                رفع ملف آخر
              </Button>
            </div>

            {/* Error Banner */}
            {!analysis.success && analysis.error && (
              <Card className="p-4 border-red-200 bg-red-50/50 dark:border-red-900/30 flex gap-3 mb-6">
                <AlertCircle className="h-6 w-6 text-red-600 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-black text-red-800 dark:text-red-300">حدث خطأ أثناء قراءة الملف!</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{analysis.error}</p>
                </div>
              </Card>
            )}

            {/* General File Stats */}
            <div className="grid gap-3 grid-cols-3 mb-6">
              <Card className="p-4 text-center">
                <p className="text-xs text-slate-400">إجمالي صفوف الملف</p>
                <p className="mt-1 text-2xl font-black text-slate-800 dark:text-white">{analysis.totalRows}</p>
              </Card>
              <Card className="p-4 text-center bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-950">
                <p className="text-xs text-emerald-600">{isDateUpdate ? "تواريخ جاهزة للتحديث" : "حركات جاهزة للاستيراد"}</p>
                <p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-300">{analysisReadyCount}</p>
              </Card>
              <Card className="p-4 text-center bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-950">
                <p className="text-xs text-red-600">{isDateUpdate ? "صحيحة مسبقاً أو تحتاج مراجعة" : "حركات غير مطابقة (ستتخطى)"}</p>
                <p className="mt-1 text-2xl font-black text-red-800 dark:text-red-300">{analysis.skippedCount}</p>
              </Card>
              {analysis.ceilingExceededCount !== undefined && analysis.ceilingExceededCount > 0 && (
                <Card className="p-4 text-center bg-amber-50/50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-950">
                  <p className="text-xs text-amber-600">حركات تجاوزت عدد الجلسات</p>
                  <p className="mt-1 text-2xl font-black text-amber-800 dark:text-amber-300">{analysis.ceilingExceededCount}</p>
                </Card>
              )}
            </div>

            {isDateUpdate && (
              <div className="mb-6 grid gap-3 sm:grid-cols-3">
                <Card className="p-3 text-center">
                  <p className="text-xs text-slate-500">صحيحة مسبقاً</p>
                  <p className="mt-1 text-xl font-black">{analysis.alreadyCorrectCount ?? 0}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xs text-slate-500">غير موجودة</p>
                  <p className="mt-1 text-xl font-black text-red-600">{analysis.missingExistingCount ?? 0}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xs text-slate-500">متعارضة</p>
                  <p className="mt-1 text-xl font-black text-red-600">{analysis.conflictCount ?? 0}</p>
                </Card>
              </div>
            )}

            {/* Aggregated Group Statistics */}
            {!isDateUpdate && <div className="space-y-3 mb-6">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">إحصائيات التجميع حسب الشركة والمرفق</h3>
              <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-3 text-slate-500 font-bold">الشركة بالمنظومة</th>
                      <th className="px-4 py-3 text-slate-500 font-bold">المرفق الصحي</th>
                      <th className="px-4 py-3 text-slate-500 font-bold">عدد الحركات</th>
                      <th className="px-4 py-3 text-slate-500 font-bold">إجمالي الجلسات</th>
                      <th className="px-4 py-3 text-slate-500 font-bold text-center">حالة المطابقة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                    {analysis.groups.map((g, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                        <td className="px-4 py-3 text-slate-900 dark:text-white font-bold">{g.companyName}</td>
                        <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{g.facilityName}</td>
                        <td className="px-4 py-3 font-bold">{g.count} حركات</td>
                        <td className="px-4 py-3 text-teal-600 font-bold">{g.totalAmount.toFixed(2)} جلسة</td>
                        <td className="px-4 py-3 text-center">
                          {g.isMatched ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 rounded font-bold text-[10px]">
                              <Check className="h-3 w-3" /> مطابق
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded font-bold text-[10px]">
                              <X className="h-3 w-3" /> غير مطابق: {g.reason}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>}

            {/* Warnings Alert */}
            {analysis.skippedCount > 0 && (
              <Card className="p-4 border-red-200 bg-red-50/20 dark:border-red-900/30 flex gap-3 mb-6">
                <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-black text-red-800 dark:text-red-300">
                    {isDateUpdate
                      ? `يوجد ${analysis.skippedCount} صف لن يحتاج أو لن يقبل تحديث التاريخ.`
                      : `يوجد ${analysis.skippedCount} حركة غير مطابقة بالكامل!`}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {isDateUpdate
                      ? dateUpdateHasBlockingIssues
                        ? "لن يسمح بالتنفيذ حتى تصبح الحركات المفقودة والمتعارضة صفراً."
                        : `سيتم تحديث ${analysisReadyCount} حركة، أما الصحيحة مسبقاً فلن تتغير.`
                      : `إذا قمت بمتابعة الاستيراد الآن، سيتم استيراد الحركات المكتملة والمطابقة فقط (${analysis.insertedCount} حركة)، وسيتم تلقائياً تخطي الحركات غير المطابقة.`}
                  </p>
                </div>
              </Card>
            )}

            {/* Warnings list */}
            {analysis.skippedCount > 0 && (
              <div className="space-y-3 mb-6">
                <h3 className="text-sm font-black text-red-800 dark:text-red-300">
                  {isDateUpdate ? "تفاصيل مطابقة تحديث التاريخ" : "تفاصيل الحركات غير المطابقة (سيتم تخطيها)"}
                </h3>
                <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                  <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-right text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-slate-500 font-bold">الصف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">الاسم بالملف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">رقم التأمين</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">المرفق بالملف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">عدد الجلسات</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">السبب</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                      {analysis.skippedDetails.map((detail, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                          <td className="px-4 py-2 text-slate-400 font-bold">#{detail.rowNumber}</td>
                          <td className="px-4 py-2 text-slate-900 dark:text-white font-bold">{detail.name || "-"}</td>
                          <td className="px-4 py-2 font-mono font-bold">{detail.card || "-"}</td>
                          <td className="px-4 py-2">{detail.facilityName || "-"}</td>
                          <td className="px-4 py-2 text-teal-600 font-bold">{detail.amount.toFixed(2)} جلسة</td>
                          <td className="px-4 py-2">
                            <Badge variant="danger" className="font-bold">
                              {detail.reason}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Ceiling Exceeded Warnings list */}
            {analysis.ceilingExceededCount !== undefined && analysis.ceilingExceededCount > 0 && (
              <div className="space-y-3 mb-6">
                <h3 className="text-sm font-black text-amber-800 dark:text-amber-300">تنبيه: حركات تتجاوز عدد الجلسات المحدد (ستُستورد للتوثيق دون أي تحميل مالي على المستفيد)</h3>
                <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                  <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-right text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-slate-500 font-bold">الصف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">الاسم بالملف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">رقم التأمين</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">المرفق بالملف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">عدد الجلسات</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">تفاصيل التجاوز</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                      {analysis.ceilingExceededDetails?.map((detail: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                          <td className="px-4 py-2 text-slate-400 font-bold">#{detail.rowNumber}</td>
                          <td className="px-4 py-2 text-slate-900 dark:text-white font-bold">{detail.name || "-"}</td>
                          <td className="px-4 py-2 font-mono font-bold">{detail.card || "-"}</td>
                          <td className="px-4 py-2">{detail.facilityName || "-"}</td>
                          <td className="px-4 py-2 text-teal-600 font-bold">{detail.amount.toFixed(2)} جلسة</td>
                          <td className="px-4 py-2 text-amber-600 font-bold max-w-[300px] whitespace-normal">
                            {detail.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Confirm Purge Caution */}
            {!isDateUpdate && purgeOld && (
              <Card className="p-4 border-amber-300 bg-amber-50/30 dark:border-amber-800/40 mb-6 flex gap-3">
                <Trash2 className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-black text-amber-800 dark:text-amber-300">تنبيه: مسح الحركات القديمة مفعل!</p>
                  <p className="text-[11px] text-slate-500">
                    عند تأكيد الاستيراد، سيقوم النظام بـ **حذف** كافة حركات العلاج الطبيعي المسجلة سابقاً لهذه الشركة المحددة نهائياً، ثم كتابة حركات ملف Excel الجديد فقط.
                  </p>
                </div>
              </Card>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Button variant="outline" onClick={resetAll} disabled={importing}>
                إلغاء الاستيراد
              </Button>
              <Button
                onClick={handleCommitImport}
                disabled={analysisReadyCount === 0 || dateUpdateHasBlockingIssues || importing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]"
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    جاري كتابة البيانات...
                  </>
                ) : (
                  isDateUpdate ? "تأكيد تحديث التواريخ" : "تأكيد وحفظ الحركات"
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Commit Import Result screen */}
      {result && (
        <Card className={`p-6 border ${result.success ? "border-emerald-200 dark:border-emerald-900/30" : "border-red-200 dark:border-red-900/30"}`}>
          <div className="flex items-start gap-3 mb-6">
            {result.success ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 mt-1 shrink-0" />
            ) : (
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400 mt-1 shrink-0" />
            )}
            <div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                {result.success
                  ? result.operationMode === "update_dates" ? "تم تحديث تواريخ الحركات بنجاح" : "تمت عملية الحفظ بنجاح"
                  : result.operationMode === "update_dates" ? "فشل تحديث تواريخ الحركات" : "فشل استيراد الحركات"}
              </h3>
              {result.error && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{result.error}</p>}
            </div>
          </div>

          {result.success && (
            <div className="space-y-6">
              <p className="text-sm text-slate-500">
                {result.operationMode === "update_dates"
                  ? "تم تغيير التاريخ ومفتاح منع التكرار فقط. لم تُنشأ حركات جديدة ولم تتغير الأرصدة أو استهلاك السقف."
                  : purgeOld
                    ? "تم مسح حركات العلاج الطبيعي القديمة بالكامل، واستيراد حركات الملف الجديد بنجاح."
                    : "تم استيراد وحفظ حركات ملف Excel بنجاح وتحديث أسقف العلاج الطبيعي التراكمية للمستفيدين."}
              </p>

              <div className="grid gap-3 grid-cols-3">
                <Card className="p-4 bg-slate-50/50 dark:bg-slate-900/20 text-center">
                  <p className="text-xs text-slate-400">إجمالي صفوف الملف</p>
                  <p className="mt-1 text-2xl font-black text-slate-800 dark:text-white">{result.totalRows}</p>
                </Card>
                <Card className="p-4 bg-emerald-50/50 dark:bg-emerald-900/10 text-center border-emerald-100 dark:border-emerald-950">
                  <p className="text-xs text-emerald-600">{result.operationMode === "update_dates" ? "تم تحديث تاريخها" : "تم حفظها بنجاح"}</p>
                  <p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-300">{result.updatedCount ?? result.insertedCount}</p>
                </Card>
                <Card className="p-4 bg-amber-50/50 dark:bg-amber-900/10 text-center border-amber-100 dark:border-amber-950">
                  <p className="text-xs text-amber-600 font-bold">{result.operationMode === "update_dates" ? "صحيحة مسبقاً" : "تم تخطيها"}</p>
                  <p className="mt-1 text-2xl font-black text-amber-800 dark:text-amber-300">{result.skippedCount}</p>
                </Card>
              </div>

              {/* عداد المستفيدين الجدد */}
              {(result.autoCreatedCount ?? 0) > 0 && (
                <div className="flex items-center gap-3 rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-800 text-teal-700 dark:text-teal-300 text-sm font-black shrink-0">
                    {result.autoCreatedCount}
                  </div>
                  <div>
                    <p className="text-sm font-black text-teal-800 dark:text-teal-300">مستفيد جديد تم إنشاؤه تلقائياً</p>
                    <p className="text-xs text-slate-500">تم إنشاء هؤلاء المستفيدين في قاعدة البيانات لأنهم كانوا في الملف دون تسجيل مسبق.</p>
                  </div>
                </div>
              )}

              {/* عداد المرافق الجدد */}
              {(result.autoCreatedFacilitiesCount ?? 0) > 0 && (
                <div className="flex items-center gap-3 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300 text-sm font-black shrink-0">
                    {result.autoCreatedFacilitiesCount}
                  </div>
                  <div>
                    <p className="text-sm font-black text-indigo-800 dark:text-indigo-300">مرفق طبي جديد تم إنشاؤه تلقائياً</p>
                    <p className="text-xs text-slate-500">تم إنشاء هذه المرافق في المنظومة لأنها غير مسجلة مسبقاً.</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button variant="outline" onClick={resetAll}>
                  استيراد ملف آخر
                </Button>
                <Link href="/admin/physiotherapy-transactions">
                  <Button className="bg-teal-600 hover:bg-teal-700 text-white">
                    العودة لجدول الحركات
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
