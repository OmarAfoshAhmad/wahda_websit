"use client";

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

export function TpaExportButton({ companyId, companyName, searchQuery, fromDate, toDate }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleExport = () => {
    const params = new URLSearchParams();
    if (companyId) params.set("company", companyId);
    if (searchQuery) params.set("q", searchQuery);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    window.open(`/api/tpa-export?${params.toString()}`, "_blank");
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={isPending}
      className="gap-2 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
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
