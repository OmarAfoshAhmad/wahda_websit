"use client";

import React, { useState } from "react";
import { PlusCircle } from "lucide-react";
import { PhysiotherapyAddTransactionModal } from "./physiotherapy-add-transaction-modal";

interface FacilityOption {
  id: string;
  name: string;
}

interface Props {
  companyId: string;
  companyName: string;
  facilities: FacilityOption[];
  defaultFacilityId: string;
  canChooseFacility: boolean;
  copayPercentage: number;
  annualCeiling: number | null;
  physiotherapySettings: any;
}

export function PhysiotherapyAddTransactionButton({
  companyId,
  companyName,
  facilities,
  defaultFacilityId,
  canChooseFacility,
  copayPercentage,
  annualCeiling,
  physiotherapySettings,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-205 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-xs font-black text-slate-705 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-350 transition-colors shadow-sm cursor-pointer"
      >
        <PlusCircle className="h-4 w-4 text-teal-605" />
        <span>إضافة حركة يدوية</span>
      </button>

      <PhysiotherapyAddTransactionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        companyId={companyId}
        companyName={companyName}
        facilities={facilities}
        defaultFacilityId={defaultFacilityId}
        canChooseFacility={canChooseFacility}
        copayPercentage={copayPercentage}
        annualCeiling={annualCeiling}
        physiotherapySettings={physiotherapySettings}
      />
    </>
  );
}
