"use client";

/**
 * DeductForm (Refactored)
 * =======================
 * المكوّن الرئيسي الآن هو مجرد "غلاف" (Shell) يوفر الـ Context
 * ويرتب المكونات الثلاثة في التسلسل الصحيح.
 * 
 * المقارنة:
 *   قبل: ملف واحد بـ 484 سطراً يخلط البحث + المنطق + التصميم
 *   بعد: 4 ملفات صغيرة متخصصة (Context + SearchEngine + BeneficiaryCard + DeductionAction)
 */

import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { DeductProvider, useDeductContext } from "./deduct/DeductContext";
import { SearchEngine } from "./deduct/SearchEngine";
import { BeneficiaryCard } from "./deduct/BeneficiaryCard";
import { DeductionAction } from "./deduct/DeductionAction";

function DeductFormInner() {
  const { beneficiary, error, success } = useDeductContext();

  return (
    <div className="space-y-4">
      <SearchEngine />

      {/* ─── رسائل الخطأ / النجاح ─── */}
      <div className="max-w-2xl mx-auto">
        {error && (
          <div className="mb-3 flex items-center rounded-md border border-red-200 bg-red-50 p-3 text-red-700 animate-in fade-in slide-in-from-top-1">
            <AlertCircle className="ml-2 h-4 w-4 shrink-0" />
            <p className="font-medium text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-3 flex items-center rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 animate-in fade-in slide-in-from-top-1">
            <CheckCircle2 className="ml-2 h-4 w-4 shrink-0" />
            <p className="font-medium text-sm">{success}</p>
          </div>
        )}
      </div>

      {/* ─── التوزيع الأفقي: البيانات والخصم ─── */}
      {beneficiary && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 animate-in fade-in zoom-in-95 duration-500">
          <div className="order-1 lg:order-1">
            <BeneficiaryCard />
          </div>
          <div className="order-2 lg:order-2">
            <DeductionAction />
          </div>
        </div>
      )}
    </div>
  );
}

export function DeductForm({ facilityType }: { facilityType?: "HOSPITAL" | "PHARMACY" }) {
  return (
    <DeductProvider facilityType={facilityType}>
      <DeductFormInner />
    </DeductProvider>
  );
}
