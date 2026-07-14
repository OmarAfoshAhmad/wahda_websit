"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      title="طباعة الكشف"
      className="bg-slate-800 hover:bg-slate-900 text-white print:hidden h-9 w-9 px-0 sm:h-10 sm:w-auto sm:px-4 inline-flex items-center justify-center"
    >
      <Printer className="h-4 w-4 shrink-0 sm:ml-2" aria-hidden="true" />
      <span className="hidden sm:inline">طباعة الكشف</span>
    </Button>
  );
}
