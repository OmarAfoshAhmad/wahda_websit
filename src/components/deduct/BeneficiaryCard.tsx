"use client";

/**
 * BeneficiaryCard
 * ===============
 * مكوّن عرض بيانات المستفيد — يقرأ البيانات من DeductContext فقط.
 * يعرض الاسم، رقم البطاقة، الأرصدة، والحالة. لا يحتوي على أي منطق.
 */

import React from "react";
import { AlertCircle } from "lucide-react";
import { Card, Badge, cn } from "@/components/ui";
import { formatCurrency } from "@/lib/money";
import { useDeductContext } from "./DeductContext";
import { DeductionAction } from "./DeductionAction";

export function BeneficiaryCard() {
  const { beneficiary, resetSearchState } = useDeductContext();

  if (!beneficiary) return null;

  return (
    <Card className="p-4 sm:p-4.5">
      {/* ─── رأس البطاقة: الاسم والحالة ─── */}
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white sm:text-xl">{beneficiary.name}</h2>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">البطاقة: {beneficiary.card_number}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetSearchState}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            اختيار مستفيد آخر
          </button>
          <Badge variant={beneficiary.status === "ACTIVE" ? "success" : "danger"}>
            {beneficiary.status === "ACTIVE" ? "نشط" : "مكتمل"}
          </Badge>
        </div>
      </div>

      {/* ─── الأرصدة ─── */}
      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">إجمالي الرصيد</p>
          <p className="text-base font-black text-slate-700 dark:text-slate-200">{formatCurrency(beneficiary.total_balance)} د.ل</p>
        </div>
        <div className={cn(
          "rounded-md p-3",
          beneficiary.remaining_balance < 50
            ? "border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30"
            : "border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
        )}>
          <p className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المتبقي</p>
          <p className={cn(
            "text-xl font-black",
            beneficiary.remaining_balance < 50 ? "text-amber-600 dark:text-amber-400" : "text-primary dark:text-blue-400"
          )}>
            {formatCurrency(beneficiary.remaining_balance)} د.ل
          </p>
          {beneficiary.remaining_balance < 50 && beneficiary.remaining_balance > 0 && (
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-500">
              الرصيد أوشك على النفاد
            </p>
          )}
        </div>
      </div>

      {/* ─── نموذج الخصم أو رسالة المكتمل ─── */}
      {beneficiary.status === "ACTIVE" && beneficiary.remaining_balance > 0 ? (
        <DeductionAction />
      ) : (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 text-center">
          <AlertCircle className="mx-auto mb-2 h-8 w-8 text-slate-400 dark:text-slate-500" />
          <p className="font-black text-slate-700 dark:text-slate-200">لا يوجد رصيد متبقٍ لهذا المستفيد.</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">تم إيقاف الخصم لأن حالة السجل مكتملة.</p>
        </div>
      )}
    </Card>
  );
}
