"use client";

import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button
      type="button"
      onClick={() => window.print()}
      title="طباعة الكشف"
      className="bg-slate-800 hover:bg-slate-900 text-white print:hidden h-9 w-9 px-0 sm:h-10 sm:w-auto sm:px-4 inline-flex items-center justify-center"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 sm:ml-2">
        <polyline points="6 9 6 2 18 2 18 9"></polyline>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
        <rect x="6" y="14" width="12" height="8"></rect>
      </svg>
      <span className="hidden sm:inline">طباعة الكشف</span>
    </Button>
  );
}
