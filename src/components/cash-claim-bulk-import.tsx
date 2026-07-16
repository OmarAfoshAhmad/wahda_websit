"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { calibrateBulkCashClaimErrors, processBulkCashClaim, type BulkImportResult } from "@/app/actions/cash-claim-bulk";
import { UploadCloud, Download, FileSpreadsheet, Loader2, AlertCircle, CheckCircle2, Scale } from "lucide-react";

const CALIBRATABLE_ERROR_CODES = new Set([
  "BALANCE_EXHAUSTED",
  "AMOUNT_EXCEEDS_BALANCE",
  "FILE_TOTAL_EXCEEDS_BALANCE",
]);

export function CashClaimBulkImport() {
  const [loading, setLoading] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  const exportErrorReport = async () => {
    if (!result?.errors.length) return;
    const XLSX = await import("xlsx");
    const reportRows = result.errors.map((error) => ({
      "رقم الصف": error.row,
      "رقم البطاقة": error.cardNumber,
      "اسم المستفيد": error.beneficiaryName || "غير متوفر",
      "نوع الخدمة": error.serviceType,
      "المبلغ": error.amount,
      "سبب الرفض": error.reason,
    }));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(reportRows);
    worksheet["!cols"] = [
      { wch: 12 }, { wch: 24 }, { wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 48 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, "الصفوف المرفوضة");
    XLSX.writeFile(workbook, `تقرير_أخطاء_Cash_Claim_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const calibrateErrors = async () => {
    if (!result) return;
    const eligible = result.errors.filter((error) => CALIBRATABLE_ERROR_CODES.has(error.errorCode));
    if (eligible.length === 0) return;
    if (!window.confirm(`سيتم إعادة توزيع مبالغ ${eligible.length} صف على أفراد العائلات الذين لديهم رصيد. هل تريد المتابعة؟`)) return;
    setCalibrating(true);
    try {
      const response = await calibrateBulkCashClaimErrors(
        eligible,
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      );
      if (response.error) {
        setResult((current) => current ? { ...current, message: response.error! } : current);
        return;
      }
      setResult((current) => {
        if (!current) return current;
        const resolvedRowSet = new Set(response.resolvedSourceRows);
        const remainingErrors = current.errors.filter((error) => !resolvedRowSet.has(error.row));
        return {
          ...current,
          success: remainingErrors.length === 0,
          message: response.success ?? "تمت المعايرة بنجاح",
          successfulRows: current.successfulRows + response.resolvedRows,
          failedRows: remainingErrors.length,
          errors: remainingErrors,
        };
      });
    } finally {
      setCalibrating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("batchId", Date.now().toString());

    try {
      const res = await processBulkCashClaim(formData);
      setResult(res);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "خطأ غير معروف";
      setResult({
        success: false,
        message: "حدث خطأ غير متوقع: " + message,
        successfulRows: 0,
        failedRows: 0,
        errors: []
      });
    } finally {
      setLoading(false);
      // مسح المدخل ليتيح رفع نفس الملف مرة أخرى إذا لزم الأمر
      e.target.value = "";
    }
  };

  return (
    <Card className="shadow-sm border-neutral-200/60 mt-6">
      <div className="bg-neutral-50/50 border-b border-neutral-100 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold">الاستيراد الجماعي (Excel)</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href="/قالب_استيراد_Cash_Claim_الكشوفات.xlsx"
              download
              className="inline-flex h-8 items-center justify-center rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50"
            >
              <Download className="ml-2 h-4 w-4" />
              ملف الكشوفات الجاهز
            </a>
            <a
              href="/قالب_استيراد_Cash_Claim_الأدوية.xlsx"
              download
              className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <Download className="ml-2 h-4 w-4" />
              ملف الأدوية الجاهز
            </a>
          </div>
        </div>
      </div>
      
      <div className="p-6 space-y-6">
        <div className="border-2 border-dashed border-neutral-200 rounded-xl p-8 text-center bg-neutral-50/50 hover:bg-neutral-50 transition-colors relative group">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            disabled={loading}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white shadow-sm border border-neutral-100 flex items-center justify-center text-neutral-400 group-hover:text-emerald-500 transition-colors">
              {loading ? <Loader2 className="w-6 h-6 animate-spin text-emerald-500" /> : <UploadCloud className="w-6 h-6" />}
            </div>
            <div>
              <p className="text-base font-medium text-neutral-700">
                {loading ? "جاري المعالجة والرفع..." : "انقر أو اسحب ملف Excel هنا"}
              </p>
              <p className="text-sm text-neutral-500 mt-1">
                يدعم صيغ .xlsx, .xls, .csv — والمبالغ أعداد صحيحة بدون كسور
              </p>
            </div>
          </div>
        </div>

        {result && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className={`p-4 rounded-lg border flex items-start gap-3 ${result.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {result.success ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" /> : <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />}
              <div>
                <h4 className="font-semibold">{result.message}</h4>
                <div className="flex gap-4 mt-2 text-sm opacity-90">
                  <span>✅ نجح: {result.successfulRows}</span>
                  <span>❌ فشل: {result.failedRows}</span>
                </div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between gap-3 bg-red-50 border-b border-red-100 px-4 py-2 font-medium text-red-800 text-sm">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    تفاصيل الأخطاء (الصفوف المرفوضة)
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {result.errors.some((error) => CALIBRATABLE_ERROR_CODES.has(error.errorCode)) && (
                      <button
                        type="button"
                        onClick={calibrateErrors}
                        disabled={calibrating}
                        className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        {calibrating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />}
                        {calibrating ? "جارٍ المعايرة..." : "معايرة الأرصدة"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={exportErrorReport}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100"
                    >
                      <Download className="h-3.5 w-3.5" />
                      تصدير التقرير XLSX
                    </button>
                  </div>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-neutral-50 sticky top-0 border-b">
                      <tr>
                        <th className="px-4 py-2 font-medium text-neutral-500">الصف</th>
                        <th className="px-4 py-2 font-medium text-neutral-500">رقم البطاقة</th>
                        <th className="px-4 py-2 font-medium text-neutral-500">اسم المستفيد</th>
                        <th className="px-4 py-2 font-medium text-neutral-500">نوع الخدمة</th>
                        <th className="px-4 py-2 font-medium text-neutral-500">المبلغ</th>
                        <th className="px-4 py-2 font-medium text-neutral-500">السبب</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-neutral-600">
                      {result.errors.map((err, i) => (
                        <tr key={i} className="hover:bg-neutral-50">
                          <td className="px-4 py-2 whitespace-nowrap">{err.row}</td>
                          <td className="px-4 py-2 whitespace-nowrap font-mono text-xs">{err.cardNumber}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{err.beneficiaryName || "غير متوفر"}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{err.serviceType}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{err.amount}</td>
                          <td className="px-4 py-2 text-red-600">{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
