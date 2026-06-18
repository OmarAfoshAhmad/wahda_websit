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
  const serviceAliases = beneficiary?.company?.service_aliases ? (beneficiary.company.service_aliases as any) : null;
  const opticsLabel = serviceAliases?.OPTICS || "خدمات البصريات";
  let categoryCoverage = 100 - copayPercentage; // default coverage

  const effectiveCopayPercentage = 100 - categoryCoverage;
  const copayFactor = effectiveCopayPercentage / 100;
  const originalCompanyShare = amountNum * (1 - copayFactor);
  const originalPatientShare = amountNum * copayFactor;

  const actualAnnualCeiling = beneficiary.total_balance;

  // تطبيق السقف السنوي
  const remaining = actualAnnualCeiling !== null ? Math.max(0, actualAnnualCeiling - yearlyConsumed) : Infinity;
  const actualCompanyShare = actualAnnualCeiling === null
    ? originalCompanyShare
    : Math.min(originalCompanyShare, remaining);
  const actualPatientShare = amountNum - actualCompanyShare;
  const isPartial = actualAnnualCeiling !== null && originalCompanyShare > remaining && remaining > 0;
  const isCeilingExhausted = actualAnnualCeiling !== null && remaining <= 0;

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
      <div className="pb-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start">
        <div>
          <h3 className="font-black text-slate-900 dark:text-white">اقتطاع {opticsLabel}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">تطبيق خصم مالي مباشر وحساب نسب التحمل</p>
        </div>
        {beneficiary.hasCustomCeiling && (
          <div className="flex items-center gap-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-800/50">
            <span className="text-sm">🌟</span>
            <span className="text-[10px] font-black uppercase tracking-wider">سقف استثنائي</span>
          </div>
        )}
      </div>



      {/* حقل القيمة */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          قيمة فاتورة {opticsLabel}
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
              <p className="font-black text-red-700 dark:text-red-400">انتهى السقف السنوي لـ {opticsLabel}</p>
              <p className="text-xs text-red-600 dark:text-red-500 mt-1">لا يمكن إجراء اقتطاع — المستهلك: {formatCurrency(yearlyConsumed)} / {actualAnnualCeiling?.toLocaleString("ar-LY")} د.ل</p>
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
              {actualAnnualCeiling !== null && (
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
          <Button
            onClick={handleDeduct}
            disabled={deducting}
            className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-white font-black text-base shadow-lg shadow-teal-600/20 rounded-lg transition-all"
          >
            {deducting ? <Loader2 className="h-5 w-5 animate-spin" /> : "تأكيد وخصم الآن"}
          </Button>
        </>
      )}
    </Card>
  );
}
