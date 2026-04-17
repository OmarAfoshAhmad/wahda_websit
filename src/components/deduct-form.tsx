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

function DeductFormInner() {
  const { error, success } = useDeductContext();

  return (
    <div className="space-y-3">
      <SearchEngine />

      {/* ─── رسائل الخطأ / النجاح ─── */}
      {error && (
        <div className="flex items-center rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
          <AlertCircle className="ml-2 h-4 w-4 shrink-0" />
          <p className="font-medium text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-center rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
          <CheckCircle2 className="ml-2 h-4 w-4 shrink-0" />
          <p className="font-medium text-sm">{success}</p>
        </div>
      )}

      <BeneficiaryCard />
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
