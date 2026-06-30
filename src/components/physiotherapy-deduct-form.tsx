"use client";

import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { PhysiotherapyDeductProvider, usePhysiotherapyDeductContext } from "./physiotherapy-deduct/PhysiotherapyDeductContext";
import { PhysiotherapySearchEngine } from "./physiotherapy-deduct/PhysiotherapySearchEngine";
import { PhysiotherapyBeneficiaryCard } from "./physiotherapy-deduct/PhysiotherapyBeneficiaryCard";
import { PhysiotherapyDeductionAction } from "./physiotherapy-deduct/PhysiotherapyDeductionAction";

interface Props {
  companyId: string;
  companyName: string;
  annualCeiling: number | null;
  copayPercentage: number;
}

function PhysiotherapyDeductFormInner() {
  const { beneficiary, error, success } = usePhysiotherapyDeductContext();

  return (
    <div className="space-y-4">
      {/* محرك البحث التفاعلي والـ Autocomplete */}
      <PhysiotherapySearchEngine />

      {/* ─── رسائل الخطأ / النجاح المشتركة ─── */}
      <div className="max-w-2xl mx-auto">
        {error && (
          <div className="mb-3 flex items-center rounded-xl border border-red-200 bg-red-50 p-3 text-red-750 animate-in fade-in slide-in-from-top-1 dark:border-red-900/30 dark:bg-red-950/10 dark:text-red-400">
            <AlertCircle className="ml-2 h-4 w-4 shrink-0 text-red-500" />
            <p className="font-bold text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-3 flex items-center rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-750 animate-in fade-in slide-in-from-top-1 dark:border-emerald-900/30 dark:bg-emerald-950/10 dark:text-emerald-400">
            <CheckCircle2 className="ml-2 h-4 w-4 shrink-0 text-emerald-500" />
            <p className="font-bold text-sm">{success}</p>
          </div>
        )}
      </div>

      {/* ─── التوزيع الأفقي المتجاوب: بطاقة المستفيد والخصم الفعلي ─── */}
      {beneficiary && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 animate-in fade-in zoom-in-95 duration-500">
          <div className="order-1 lg:order-1">
            <PhysiotherapyBeneficiaryCard />
          </div>
          <div className="order-2 lg:order-2">
            <PhysiotherapyDeductionAction />
          </div>
        </div>
      )}
    </div>
  );
}

export function PhysiotherapyDeductForm({
  companyId,
  companyName,
  annualCeiling,
  copayPercentage,
}: Props) {
  return (
    <PhysiotherapyDeductProvider
      companyId={companyId}
      companyName={companyName}
      annualCeiling={annualCeiling}
      copayPercentage={copayPercentage}
    >
      <PhysiotherapyDeductFormInner />
    </PhysiotherapyDeductProvider>
  );
}
