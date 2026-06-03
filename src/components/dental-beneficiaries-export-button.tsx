"use client";

import React, { useState, useTransition } from "react";
import { Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

interface Props {
  companyId?: string;
  searchQuery?: string;
}

export function DentalBeneficiariesExportButton({ companyId, searchQuery }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleExport = () => {
    const params = new URLSearchParams();
    if (companyId) params.set("company", companyId);
    if (searchQuery) params.set("q", searchQuery);

    window.open(`/api/dental-beneficiaries-export?${params.toString()}`, "_blank");
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={isPending}
      className="gap-2 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Users className="h-4 w-4" />
      )}
      تصدير المستفيدين
    </Button>
  );
}
