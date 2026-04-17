"use client";

/**
 * DeductionAction
 * ===============
 * مكوّن الخصم — يعرض حقل المبلغ، نوع الخصم، وشاشة التأكيد.
 * منفصل تماماً عن منطق البحث وبيانات المستفيد.
 */

import React from "react";
import { CreditCard, DollarSign, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useDeductContext } from "./DeductContext";
import { MAX_DEDUCTION_AMOUNT, MAX_AMOUNT_POLICY_ERROR } from "@/lib/validation";

export function DeductionAction() {
  const {
    beneficiary, amount, setAmount,
    type, setType, showConfirm, setShowConfirm,
    deducting, handleDeduct,
  } = useDeductContext();

  // لا نعرض شيئاً إذا لم يكن هناك مستفيد نشط برصيد
  if (!beneficiary || beneficiary.status !== "ACTIVE" || beneficiary.remaining_balance <= 0) {
    return null;
  }

  const amountValue = Number(amount);
  const amountExceedsMax = Number.isFinite(amountValue) && amountValue > MAX_DEDUCTION_AMOUNT;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {/* ─── حقل المبلغ ─── */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            قيمة الخصم
          </label>
          <div className="relative">
            <DollarSign className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <Input
              type="number"
              step="0.01"
              max={String(MAX_DEDUCTION_AMOUNT)}
              placeholder="0.00"
              className="h-10 pr-9 text-sm font-black"
              value={amount}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setAmount("");
                  return;
                }
                setAmount(raw);
              }}
            />
          </div>
          {amountExceedsMax && (
            <p className="text-xs font-bold text-red-600 dark:text-red-400">{MAX_AMOUNT_POLICY_ERROR}</p>
          )}
        </div>

        {/* ─── نوع الخصم ─── */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            النوع
          </label>
          <select
            className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            value={type}
            onChange={(e) => setType(e.target.value as "MEDICINE" | "SUPPLIES")}
          >
            <option value="MEDICINE">ادوية صرف عام</option>
            <option value="SUPPLIES">كشف عام</option>
          </select>
        </div>
      </div>

      {/* ─── زر المراجعة ─── */}
      {!showConfirm ? (
        <Button
          className="h-10 w-full text-sm"
          onClick={() => amount && setShowConfirm(true)}
          disabled={!amount || parseFloat(amount) <= 0 || amountExceedsMax}
        >
          <CreditCard className="h-4 w-4" />
          <span className="mr-2">مراجعة الخصم</span>
        </Button>
      ) : (
        /* ─── شاشة التأكيد ─── */
        <div className="space-y-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 text-slate-900 dark:text-slate-200">
          <div className="text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">أنت على وشك خصم</p>
            <p className="text-xl font-black text-slate-950 dark:text-white">{amount} د.ل</p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {type === "MEDICINE" ? "ادوية صرف عام" : "كشف عام"} • {beneficiary.name}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              className="h-10 flex-1"
              onClick={() => setShowConfirm(false)}
              disabled={deducting}
            >
              إلغاء
            </Button>
            <Button
              className="h-10 flex-1"
              onClick={handleDeduct}
              disabled={deducting}
            >
              {deducting ? <Loader2 className="h-5 w-5 animate-spin" /> : "تأكيد التنفيذ"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
