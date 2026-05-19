"use client";

/**
 * DentalExportButton
 * ==================
 * زر تصدير كشف أسنان منظم لكل شركة أو جميع الشركات
 */

import React, { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

interface Props {
  companyId?: string;
  companyName?: string;
  searchQuery?: string;
  fromDate?: string;
  toDate?: string;
}

export function DentalExportButton({ companyId, companyName, searchQuery, fromDate, toDate }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleExport = () => {
    const params = new URLSearchParams();
    if (companyId) params.set("company", companyId);
    if (searchQuery) params.set("q", searchQuery);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    window.open(`/api/dental-export?${params.toString()}`, "_blank");
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={isPending}
      className="gap-2 border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {companyName ? `تصدير كشف ${companyName}` : "تصدير الكشف"}
    </Button>
  );
}
