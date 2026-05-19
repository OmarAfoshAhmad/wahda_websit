"use client";

import React from "react";
import { AlertCircle, Shield, Calendar, ArrowLeftRight } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { useDentalDeductContext } from "./DentalDeductContext";

export function DentalBeneficiaryCard() {
  const {
    beneficiary,
    resetSearchState,
    annualCeiling,
    copayPercentage,
    yearlyConsumed,
    remainingCeiling,
  } = useDentalDeductContext();

  if (!beneficiary) return null;

  const isActive = beneficiary.status === "ACTIVE";
  const isSuspended = beneficiary.status === "SUSPENDED";

  return (
    <Card className="p-5 border border-teal-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-xl">
      {/* ─── رأس البطاقة: الاسم والحالة والشركة ─── */}
      <div className="mb-5 flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white leading-tight">{beneficiary.name}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">البطاقة: {beneficiary.card_number}</p>
            {beneficiary.company && (
              <Badge variant="info" className="text-[10px] py-0 px-2 h-5 flex items-center gap-1 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {beneficiary.company.logo ? (
                  <img src={beneficiary.company.logo} alt="Logo" className="h-3 w-3 object-contain" />
                ) : (
                  <Shield className="h-3 w-3 text-teal-600" />
                )}
                {beneficiary.company.name}
              </Badge>
            )}
            <Badge variant={isActive ? "success" : "danger"} className="text-[10px] py-0 px-2 h-5">
              {isActive ? "نشط" : isSuspended ? "موقوف" : beneficiary.status}
            </Badge>
          </div>
        </div>
        <button
          type="button"
          onClick={resetSearchState}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <ArrowLeftRight className="h-3 w-3" />
          تغيير المستفيد
        </button>
      </div>

      {/* ─── السياسة المالية للأسنان (4 كروت صغيرة) ─── */}
      <div className="grid grid-cols-2 gap-3 mb-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3 text-center">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">السقف السنوي</p>
          <p className="mt-1.5 text-base font-black text-slate-800 dark:text-slate-200">
            {annualCeiling !== null ? `${formatCurrency(annualCeiling)} د.ل` : "مفتوح"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3 text-center">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">المستهلك هذا العام</p>
          <p className="mt-1.5 text-base font-black text-amber-600 dark:text-amber-400">
            {formatCurrency(yearlyConsumed)} د.ل
          </p>
        </div>

        <div className="rounded-xl border border-teal-100 dark:border-teal-900 bg-teal-50/20 dark:bg-teal-900/10 p-3 text-center">
          <p className="text-[9px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-400">المتبقي في السقف</p>
          <p className="mt-1.5 text-base font-black text-teal-700 dark:text-teal-400">
            {remainingCeiling !== null ? `${formatCurrency(remainingCeiling)} د.ل` : "∞ مفتوح"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3 text-center">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">تحمل المؤمن</p>
          <p className="mt-1.5 text-base font-black text-slate-800 dark:text-slate-200">
            {copayPercentage}%
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 px-3 py-2 text-[11px] font-bold text-slate-500">
        <Calendar className="h-3.5 w-3.5 text-teal-600 shrink-0" />
        <span>تاريخ صلاحية السياسة: السنة المالية الحالية {new Date().getFullYear()}</span>
      </div>

      {/* تنبيه حالة المستفيد */}
      {isSuspended && (
        <div className="mt-4 rounded-xl border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-900/10 p-4 text-center">
          <AlertCircle className="mx-auto mb-2 h-7 w-7 text-red-500" />
          <p className="font-black text-red-700 dark:text-red-400">حساب المستفيد موقوف</p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-500">
            تم إيقاف الخصم لهذا المستفيد مؤقتاً في النظام الرئيسي. يرجى مراجعة المسؤول.
          </p>
        </div>
      )}
    </Card>
  );
}
