"use client";

import React from "react";
import { CreditCard, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button, Input, Card } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { useOpticsDeductContext } from "./OpticsDeductContext";

export function OpticsDeductionAction() {
  const {
    beneficiary,
    amount,
    setAmount,
    subCategory,
    setSubCategory,
    showConfirm,
    setShowConfirm,
    deducting,
    handleDeduct,
    yearlyConsumed,
    annualCeiling,
    copayPercentage,
    remainingCeiling,
    companyName,
    error,
    success,
    resetSearchState,
  } = useOpticsDeductContext();

  if (!beneficiary) return null;

  const isSuspended = beneficiary.status === "SUSPENDED";
  if (isSuspended) return null;

  const amountNum = parseFloat(amount) || 0;
  const hasAmount = amountNum > 0;

  // حساب فوري للحصص
  const settings = beneficiary?.company?.optics_settings ? (beneficiary.company.optics_settings as any) : null;
  const hasCustomPolicies = !!(
    settings?.ortho?.enabled ||
    settings?.implant?.enabled ||
    settings?.prosthetics?.enabled
  );
  let categoryCoverage = 100 - copayPercentage; // default coverage
  if (subCategory === "OPTICS_ORTHO" && settings?.ortho?.enabled) {
    categoryCoverage = Number(settings.ortho.coverage);
  } else if (subCategory === "OPTICS_IMPLANT" && settings?.implant?.enabled) {
    categoryCoverage = Number(settings.implant.coverage);
  } else if (subCategory === "OPTICS_PROSTHETICS" && settings?.prosthetics?.enabled) {
    categoryCoverage = Number(settings.prosthetics.coverage);
  }
  const effectiveCopayPercentage = 100 - categoryCoverage;
  const copayFactor = effectiveCopayPercentage / 100;
  const originalCompanyShare = amountNum * (1 - copayFactor);
  const originalPatientShare = amountNum * copayFactor;

  // تطبيق السقف السنوي
  const remaining = remainingCeiling !== null ? remainingCeiling : Infinity;
  const actualCompanyShare = annualCeiling === null
    ? originalCompanyShare
    : Math.min(originalCompanyShare, remaining);
  const actualPatientShare = amountNum - actualCompanyShare;
  const isPartial = annualCeiling !== null && originalCompanyShare > remaining && remaining > 0;
  const isCeilingExhausted = annualCeiling !== null && remaining <= 0;

  if (success) {
    return (
      <Card className="p-6 border border-emerald-100 dark:border-emerald-950 bg-emerald-50/20 dark:bg-emerald-950/10 text-center rounded-xl flex flex-col items-center justify-center gap-3 min-h-[300px]">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-8 w-8 animate-bounce" />
        </div>
        <h3 className="text-lg font-black text-slate-900 dark:text-white">تم الاقتطاع بنجاح</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm">
          تم تسجيل عملية اقتطاع بصريات بقيمة <span className="font-black text-slate-800 dark:text-white">{formatCurrency(amountNum)} د.ل</span> بنجاح للمستفيد {beneficiary.name}
        </p>
        <Button
          variant="outline"
          onClick={resetSearchState}
          className="mt-3 font-bold border-teal-600 text-teal-600 hover:bg-teal-50 dark:border-teal-500 dark:text-teal-400"
        >
          خصم خدمة أخرى
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5 border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm space-y-4">
      <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
        <h3 className="font-black text-slate-900 dark:text-white">اقتطاع خدمات البصريات</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">تطبيق خصم مالي مباشر وحساب نسب التحمل</p>
      </div>

      {/* اختيار نوع الخدمة إذا كان هناك سياسات مخصصة */}
      {hasCustomPolicies && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-550">
            تصنيف خدمة البصريات
          </label>
          <select
            id="optics-subcategory-select"
            className="flex h-11 w-full rounded-md border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-bold text-slate-900 focus-visible:outline-none focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            value={subCategory}
            onChange={(e) => {
              setSubCategory(e.target.value);
              setShowConfirm(false);
            }}
            disabled={deducting}
          >
            <option value="OPTICS">خدمات بصريات عامة ({100 - copayPercentage}% تغطية)</option>
            {settings?.ortho?.enabled && (
              <option value="OPTICS_ORTHO">تقويم البصريات ({settings.ortho.coverage}% تغطية)</option>
            )}
            {settings?.implant?.enabled && (
              <option value="OPTICS_IMPLANT">زراعة البصريات ({settings.implant.coverage}% تغطية)</option>
            )}
            {settings?.prosthetics?.enabled && (
              <option value="OPTICS_PROSTHETICS">تركيبات البصريات ({settings.prosthetics.coverage}% تغطية)</option>
            )}
          </select>
        </div>
      )}

      {/* حقل القيمة */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          قيمة فاتورة البصريات
        </label>
        <div className="relative">
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-600 dark:text-teal-400">
            <CreditCard className="h-4 w-4" />
          </div>
          <Input
            id="optics-amount-input"
            type="number"
            step="0.25"
            min="0"
            placeholder="0.00"
            className="h-11 pr-10 text-base font-black focus-visible:ring-teal-500/30 dark:bg-slate-950"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setShowConfirm(false);
            }}
            disabled={deducting}
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-slate-400">
            د.ل
          </div>
        </div>
      </div>

      {/* محاكاة الحسابات التفاعلية */}
      {hasAmount && (
        <div className={`rounded-xl border p-4 space-y-3 transition-colors ${
          isCeilingExhausted
            ? "border-red-200 bg-red-50 dark:border-red-900/20 dark:bg-red-950/10"
            : isPartial
            ? "border-amber-200 bg-amber-50 dark:border-amber-900/20 dark:bg-amber-950/10"
            : "border-teal-100 bg-teal-50/20 dark:border-teal-900/20 dark:bg-teal-950/10"
        }`}>
          {isCeilingExhausted ? (
            <div className="text-center py-2">
              <p className="font-black text-red-700 dark:text-red-400">انتهى السقف السنوي لخدمات البصريات</p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-1">لا يمكن إجراء اقتطاع — المستهلك: {formatCurrency(yearlyConsumed)} / {annualCeiling?.toLocaleString("ar-LY")} د.ل</p>
            </div>
          ) : (
            <>
              {isPartial && (
                <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/30 rounded px-2.5 py-1 flex items-center gap-1">
                  ⚠️ سقف البصريات غير كافٍ لتغطية كامل حصة الشركة. سيتم تطبيق تغطية جزئية.
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">على {companyName}</p>
                  <p className="text-2xl font-black text-teal-700 dark:text-teal-400 leading-tight">{formatCurrency(actualCompanyShare)}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">د.ل</p>
                </div>
                <div className="border-r border-slate-200 dark:border-slate-800 pr-4">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">على المؤمن (كاش)</p>
                  <p className="text-2xl font-black text-amber-600 dark:text-amber-450 leading-tight">{formatCurrency(actualPatientShare)}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">د.ل</p>
                </div>
              </div>
              {annualCeiling !== null && (
                <div className="pt-2.5 border-t border-slate-200/50 dark:border-slate-850 text-xs text-slate-500 dark:text-slate-400">
                  الرصيد المتبقي بعد الاقتطاع: <span className="font-black text-slate-700 dark:text-slate-355">
                    {Math.max(0, remaining - actualCompanyShare).toLocaleString("ar-LY")} د.ل
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* رسالة الخطأ */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/10 p-3 text-red-700 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <p className="text-xs font-bold leading-relaxed">{error}</p>
        </div>
      )}

      {/* أزرار العمليات */}
      {hasAmount && !isCeilingExhausted && (
        <>
          {!showConfirm ? (
            <Button
              onClick={() => setShowConfirm(true)}
              className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-black text-sm rounded-lg transition-all"
            >
              مراجعة وتأكيد الاقتطاع
            </Button>
          ) : (
            <div className="space-y-3 rounded-xl border-2 border-teal-200 dark:border-teal-900/60 bg-teal-50/20 dark:bg-teal-950/10 p-4">
              <div className="text-center space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">تأكيد الاقتطاع النهائي (حصة الشركة)</p>
                <p className="text-2xl font-black text-teal-700 dark:text-teal-400">{formatCurrency(actualCompanyShare)} د.ل</p>
                
                <div className="mt-1 flex flex-col gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-350 bg-white dark:bg-slate-800/50 rounded-lg p-2.5 border border-slate-200/60 dark:border-slate-700">
                  <div className="flex justify-between">
                    <span>إجمالي الفاتورة:</span>
                    <span>{formatCurrency(amountNum)} د.ل</span>
                  </div>
                  <div className="flex justify-between text-teal-655 dark:text-teal-400 border-t border-dashed border-slate-100 dark:border-slate-800 pt-1">
                    <span>حصة الشركة ({categoryCoverage}%):</span>
                    <span>{formatCurrency(actualCompanyShare)} د.ل</span>
                  </div>
                  <div className="flex justify-between text-amber-655 dark:text-amber-400">
                    <span>تحمل المريض ({effectiveCopayPercentage}%):</span>
                    <span>{formatCurrency(actualPatientShare)} د.ل</span>
                  </div>
                </div>

                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-slate-800 px-3 py-1 text-[10px] font-bold text-slate-500 border border-slate-200 dark:border-slate-750">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                  {subCategory === "OPTICS_ORTHO" ? "تقويم البصريات" :
                   subCategory === "OPTICS_IMPLANT" ? "زراعة البصريات" :
                   subCategory === "OPTICS_PROSTHETICS" ? "تركيبات البصريات" : "بصريات عامة"} • {beneficiary.name}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleDeduct}
                  disabled={deducting}
                  className="flex-1 h-11 bg-teal-600 hover:bg-teal-700 text-white font-black text-sm rounded-lg"
                >
                  {deducting ? <Loader2 className="h-4 w-4 animate-spin" /> : "تأكيد وخصم الآن"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  disabled={deducting}
                  className="flex-1 h-11 font-bold text-xs rounded-lg"
                >
                  رجوع للتعديل
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
