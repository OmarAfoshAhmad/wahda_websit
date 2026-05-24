"use client";

import React, { useState } from "react";
import { Upload, FileSpreadsheet, AlertCircle, Loader2, CheckCircle2, ChevronLeft, Info, Trash2, Check, X, ShieldAlert } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { importDentalTransactionsAction, type SkippedRowDetail, type SummaryGroup } from "@/app/actions/import-dental-transactions";
import Link from "next/link";

interface CompanyOption {
  id: string;
  name: string;
}

export function DentalTransactionImportUploader({
  companies,
  initialCompanyId,
}: {
  companies: CompanyOption[];
  initialCompanyId?: string;
}) {
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId || "");
  const [file, setFile] = useState<File | null>(null);
  const [purgeOld, setPurgeOld] = useState(false);
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
    skippedDetails: SkippedRowDetail[];
    groups: SummaryGroup[];
  } | null>(null);

  // Final result (Commit run)
  const [result, setResult] = useState<{
    success: boolean;
    error?: string;
    totalRows: number;
    insertedCount: number;
    skippedCount: number;
    autoCreatedCount: number;
    skippedDetails: SkippedRowDetail[];
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
            skippedDetails: [],
            groups: [],
          });
          setAnalyzing(false);
          return;
        }

        setFileBase64(base64);

        // Run dry-run scan
        const res = await importDentalTransactionsAction(base64, false, true, selectedCompanyId);
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
      const res = await importDentalTransactionsAction(fileBase64, purgeOld, false, selectedCompanyId);
      setResult(res);
      setImporting(false);
    } catch (err: any) {
      setResult({
        success: false,
        error: err.message || "حدث خطأ أثناء إتمام عملية الاستيراد الفعلي.",
        totalRows: 0,
        insertedCount: 0,
        skippedCount: 0,
        skippedDetails: [],
      });
      setImporting(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setAnalysis(null);
    setResult(null);
    setFileBase64(null);
    setPurgeOld(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Step 1: Upload and Configure */}
      {!analysis && !result && (
        <Card className="p-6">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-4 mb-6">
            <FileSpreadsheet className="h-6 w-6 text-teal-600 dark:text-teal-400" />
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">تحميل وتحليل ملف حركات الأسنان</h2>
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

            {/* File Picker */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">ملف حركات الأسنان (.xlsx)</label>
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

            {/* Purge Old Option */}
            <Card className="p-4 border-amber-200 bg-amber-50/20 dark:border-amber-900/30">
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
                    مسح جميع حركات الأسنان السابقة الخاصة بهذه الشركة فقط قبل الاستيراد
                  </label>
                  <p className="text-xs text-slate-500">
                    إذا قمت بتفعيل هذا الخيار، سيتم حذف كل الحركات المسجلة لعيادات الأسنان (`DENTAL`) الخاصة بالشركة المحددة في المنظومة قبل حفظ الحركات المرفوعة حديثاً.
                  </p>
                </div>
              </div>
            </Card>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Link href="/admin/dental-transactions">
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
                  تم تجميع البيانات ومطابقتها للتأكد من دقة الأسماء والمرافق قبل إتمام الحفظ.
                </p>
              </div>
              <Button variant="outline" onClick={resetAll} disabled={importing}>
                رفع ملف آخر
              </Button>
            </div>

            {/* General File Stats */}
            <div className="grid gap-3 grid-cols-3 mb-6">
              <Card className="p-4 text-center">
                <p className="text-xs text-slate-400">إجمالي صفوف الملف</p>
                <p className="mt-1 text-2xl font-black text-slate-800 dark:text-white">{analysis.totalRows}</p>
              </Card>
              <Card className="p-4 text-center bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-950">
                <p className="text-xs text-emerald-600">حركات جاهزة للاستيراد</p>
                <p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-300">{analysis.insertedCount}</p>
              </Card>
              <Card className="p-4 text-center bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-950">
                <p className="text-xs text-red-600">حركات غير مطابقة (ستتخطى)</p>
                <p className="mt-1 text-2xl font-black text-red-800 dark:text-red-300">{analysis.skippedCount}</p>
              </Card>
            </div>

            {/* Aggregated Group Statistics */}
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">إحصائيات التجميع حسب الشركة والمرفق</h3>
              <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-right text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-3 text-slate-500 font-bold">الشركة بالمنظومة</th>
                      <th className="px-4 py-3 text-slate-500 font-bold">المرفق الصحي</th>
                      <th className="px-4 py-3 text-slate-500 font-bold">عدد الحركات</th>
                      <th className="px-4 py-3 text-slate-500 font-bold">إجمالي القيمة</th>
                      <th className="px-4 py-3 text-slate-500 font-bold text-center">حالة المطابقة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                    {analysis.groups.map((g, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                        <td className="px-4 py-3 text-slate-900 dark:text-white font-bold">{g.companyName}</td>
                        <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{g.facilityName}</td>
                        <td className="px-4 py-3 font-bold">{g.count} حركات</td>
                        <td className="px-4 py-3 text-teal-600 font-bold">{g.totalAmount.toFixed(2)} د.ل</td>
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
            </div>

            {/* Warnings Alert */}
            {analysis.skippedCount > 0 && (
              <Card className="p-4 border-red-200 bg-red-50/20 dark:border-red-900/30 flex gap-3 mb-6">
                <ShieldAlert className="h-5 w-5 text-red-600 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-black text-red-800 dark:text-red-300">يوجد {analysis.skippedCount} حركة غير مطابقة بالكامل!</p>
                  <p className="text-[11px] text-slate-500">
                    إذا قمت بمتابعة الاستيراد الآن، سيتم استيراد الحركات المكتملة والمطابقة فقط ({analysis.insertedCount} حركة)، وسيتم تلقائياً تخطي الحركات غير المطابقة.
                  </p>
                </div>
              </Card>
            )}

            {/* Warnings list */}
            {analysis.skippedCount > 0 && (
              <div className="space-y-3 mb-6">
                <h3 className="text-sm font-black text-red-800 dark:text-red-300">تفاصيل الحركات غير المطابقة (سيتم تخطيها)</h3>
                <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                  <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-right text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-slate-500 font-bold">الصف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">الاسم بالملف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">رقم التأمين</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">المرفق بالملف</th>
                        <th className="px-4 py-2 text-slate-500 font-bold">المبلغ</th>
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
                          <td className="px-4 py-2 text-teal-600 font-bold">{detail.amount.toFixed(2)} د.ل</td>
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

            {/* Confirm Purge Caution */}
            {purgeOld && (
              <Card className="p-4 border-amber-300 bg-amber-50/30 dark:border-amber-800/40 mb-6 flex gap-3">
                <Trash2 className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-black text-amber-800 dark:text-amber-300">تنبيه: مسح الحركات القديمة مفعل!</p>
                  <p className="text-[11px] text-slate-500">
                    عند تأكيد الاستيراد، سيقوم النظام بـ **حذف** كافة حركات الأسنان المسجلة سابقاً لهذه الشركة المحددة نهائياً، ثم كتابة حركات ملف Excel الجديد فقط.
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
                disabled={analysis.insertedCount === 0 || importing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]"
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    جاري كتابة البيانات...
                  </>
                ) : (
                  "تأكيد وحفظ الحركات"
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
                {result.success ? "تمت عملية الحفظ بنجاح باهر" : "فشل استيراد الحركات"}
              </h3>
              {result.error && <p className="text-sm text-red-600 dark:text-red-400 mt-1">{result.error}</p>}
            </div>
          </div>

          {result.success && (
            <div className="space-y-6">
              <p className="text-sm text-slate-500">
                {purgeOld
                  ? "تم مسح حركات الأسنان القديمة بالكامل، واستيراد حركات الملف الجديد بنجاح."
                  : "تم استيراد وحفظ حركات ملف Excel بنجاح وتحديث أسقف الأسنان التراكمية للمستفيدين."}
              </p>

              <div className="grid gap-3 grid-cols-3">
                <Card className="p-4 bg-slate-50/50 dark:bg-slate-900/20 text-center">
                  <p className="text-xs text-slate-400">إجمالي صفوف الملف</p>
                  <p className="mt-1 text-2xl font-black text-slate-800 dark:text-white">{result.totalRows}</p>
                </Card>
                <Card className="p-4 bg-emerald-50/50 dark:bg-emerald-900/10 text-center border-emerald-100 dark:border-emerald-950">
                  <p className="text-xs text-emerald-600">تم حفظها بنجاح</p>
                  <p className="mt-1 text-2xl font-black text-emerald-800 dark:text-emerald-300">{result.insertedCount}</p>
                </Card>
                <Card className="p-4 bg-amber-50/50 dark:bg-amber-900/10 text-center border-amber-100 dark:border-amber-950">
                  <p className="text-xs text-amber-600 font-bold">تم تخطيها</p>
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

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button variant="outline" onClick={resetAll}>
                  استيراد ملف آخر
                </Button>
                <Link href="/admin/dental-transactions">
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
