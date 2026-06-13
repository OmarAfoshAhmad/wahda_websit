"use client";

/**
 * DeductionAction
 * ===============
 * مكوّن الخصم — النسخة المحسنة (وضوح عالي + استغلال مساحة).
 */

import React from "react";
import { CreditCard, DollarSign, Loader2 } from "lucide-react";
import { Button, Input, Badge, cn } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { useDeductContext } from "./DeductContext";
import {
  isAllowedDeductionAmount,
  MAX_DEDUCTION_AMOUNT,
  MAX_AMOUNT_POLICY_ERROR,
} from "@/lib/validation";

export function DeductionAction() {
  const {
    beneficiary, amount, setAmount,
    type, setType, availableServiceTypes, facilityType, showConfirm, setShowConfirm,
    deducting, handleDeduct,
    simulation, simulating
  } = useDeductContext();

  // لا نعرض شيئاً إذا لم يكن هناك مستفيد نشط
  if (!beneficiary || beneficiary.status !== "ACTIVE") {
    return null;
  }

  const amountValue = Number(amount);
  const amountExceedsMax = Number.isFinite(amountValue) && amountValue > MAX_DEDUCTION_AMOUNT;
  const hasAmount = Number.isFinite(amountValue) && amountValue > 0;

  const typeLabels: Record<string, string> = {
    GENERAL: "كشف عام",
    MEDICINE: "أدوية صرف عام",
    DENTAL: "خدمات أسنان",
    OPTICS: "خدمات بصريات / عيون",
    SUPPLIES: "مستلزمات طبية",
  };

  let filteredTypes = availableServiceTypes.length > 0
    ? [...availableServiceTypes]
    : ["GENERAL", "MEDICINE"];

  if (facilityType === "PHARMACY") {
    filteredTypes = filteredTypes.filter(t => t === "MEDICINE");
    if (filteredTypes.length === 0) filteredTypes = ["MEDICINE"];
  } else if (facilityType === "DENTAL") {
    filteredTypes = filteredTypes.filter(t => t === "DENTAL");
    if (filteredTypes.length === 0) filteredTypes = ["DENTAL"];
  } else if (facilityType === "OPTICS") {
    filteredTypes = filteredTypes.filter(t => t === "OPTICS");
    if (filteredTypes.length === 0) filteredTypes = ["OPTICS"];
  } else {
    // For HOSPITAL or general admin view, remove DENTAL unless they are explicitly in a DENTAL facility.
    // The user requested: "في مصرف الوحدة كشف عام و ادوية صرف عام فقط و عندما اكون في وضع الاسنان يظهر فقط قسم الاسنان"
    filteredTypes = filteredTypes.filter(t => t !== "DENTAL");
    
    if (filteredTypes.length === 0) {
      filteredTypes = ["GENERAL", "MEDICINE"];
    }
  }

  const serviceTypes = filteredTypes.map((t) => ({ value: t, label: typeLabels[t] || t }));

  return (
    <div className="space-y-4">
      {/* ─── الحقول الأساسية: التصنيف والمبلغ بجانب بعض ─── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* تصنيف الخدمة */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            تصنيف الخدمة
          </label>
          <select
            className="flex h-11 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            value={type}
            onChange={(e) => setType(e.target.value as any)}
          >
            {serviceTypes.map(st => (
              <option key={st.value} value={st.value}>{st.label}</option>
            ))}
          </select>
        </div>

        {/* قيمة الخدمة */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            قيمة الخدمة
          </label>
          <div className="relative">
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <CreditCard className="h-4 w-4" />
            </div>
            <Input
              type="number"
              step="0.25"
              placeholder="0.00"
              className={cn(
                "h-11 pr-10 text-base font-black",
                amountExceedsMax ? "border-red-500 focus-visible:ring-red-500/20" : "focus-visible:ring-primary/20"
              )}
              value={amount || ""}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-slate-400">
              د.ل
            </div>
          </div>
        </div>
      </div>

      {/* ─── محاكي الخصم (Simulation Panel) ─── */}
      {hasAmount && !amountExceedsMax && (
        <div className={cn(
          "relative overflow-hidden rounded-lg border p-4 transition-all duration-300",
          simulating ? "opacity-60" : "opacity-100",
          simulation?.isTpa 
            ? "bg-blue-50/50 border-blue-100 dark:bg-blue-950/30 dark:border-blue-900/50" 
            : "bg-slate-50 border-slate-200 dark:bg-slate-800/80 dark:border-slate-700"
        )}>
          {process.env.NEXT_PUBLIC_APP_MODE?.replace(/["']/g, '').toUpperCase() === "WAHDA_ONLY" ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">قيمة الخصم</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white">{formatCurrency(amountValue)} د.ل</p>
              </div>
            </div>
          ) : simulation?.isTpa ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="info" className="text-[10px] py-0 px-2 h-4 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800">نظام السقف</Badge>
                  {simulation.calcResult.isPartialCoverage && (
                    <Badge variant="danger" className="text-[10px] py-0 px-2 h-4 animate-pulse dark:bg-red-900/50 dark:text-red-300 dark:border-red-800">تغطية جزئية</Badge>
                  )}
                </div>
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">على الجهة الضامنة</p>
                <p className="text-xl font-black text-blue-600 dark:text-blue-400">{formatCurrency(simulation.calcResult.actualCompanyShare)}</p>
              </div>
              <div className="space-y-1 border-r border-slate-200 dark:border-slate-700 pl-4 text-left">
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider mt-5 sm:mt-6">يدفعه المؤمن (كاش)</p>
                <p className="text-xl font-black text-amber-600 dark:text-amber-500">{formatCurrency(simulation.calcResult.actualPatientShare)}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">سيتم خصمه من الرصيد</p>
                <p className="text-2xl font-black text-slate-700 dark:text-slate-200">{formatCurrency(amountValue)} د.ل</p>
              </div>
              <Badge variant="default" className="dark:bg-slate-700 dark:text-slate-100">رصيد مباشر</Badge>
            </div>
          )}
        </div>
      )}

      {/* ─── أخطاء السياسة ─── */}
      {amountExceedsMax && (
        <div className="rounded-md bg-red-50 p-3 text-xs font-bold text-red-600 border border-red-100">
          خطأ: {MAX_AMOUNT_POLICY_ERROR}
        </div>
      )}

      {/* ─── زر التأكيد المباشر ─── */}
      {hasAmount && !amountExceedsMax && (
        <Button
          onClick={handleDeduct}
          disabled={deducting || simulating}
          className="w-full h-12 text-base font-black shadow-lg shadow-primary/20 bg-teal-600 hover:bg-teal-700 text-white dark:bg-teal-600 dark:hover:bg-teal-500 transition-all"
        >
          {deducting ? <Loader2 className="h-5 w-5 animate-spin" /> : "تأكيد وخصم الآن"}
        </Button>
      )}
    </div>
  );
}
