"use client";

import { useState, useEffect, useCallback } from "react";
import { Printer, FileText, FileStack, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useSearchParams } from "next/navigation";

export function SmartPrintButton() {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const handlePrintCurrent = useCallback(() => {
    window.print();
    setOpen(false);
  }, []);

  const handlePrintFull = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    window.open(`/transactions/print?${params.toString()}`, "_blank");
    setOpen(false);
  }, [searchParams]);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        title="خيارات الطباعة"
        className="bg-slate-800 hover:bg-slate-900 text-white print:hidden h-9 w-9 px-0 sm:h-10 sm:w-auto sm:px-4 inline-flex items-center justify-center gap-2"
      >
        <Printer className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">طباعة الكشف</span>
      </Button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 p-2 rounded-lg text-primary">
                  <Printer className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">خيارات الطباعة</h3>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <button
                onClick={handlePrintCurrent}
                className="group flex w-full items-center gap-4 rounded-xl border border-slate-200 p-4 text-right transition-all hover:border-primary hover:bg-primary/5 dark:border-slate-800 dark:hover:bg-primary/10"
              >
                <div className="bg-slate-100 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                  <FileText className="h-6 w-6 text-slate-600 group-hover:text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-slate-900 dark:text-white text-base">طباعة الصفحة الحالية</p>
                  <p className="text-xs text-slate-500 mt-1">طباعة الـ 10 حركات المعروضة حالياً فقط.</p>
                </div>
              </button>

              <button
                onClick={handlePrintFull}
                className="group flex w-full items-center gap-4 rounded-xl border border-slate-200 p-4 text-right transition-all hover:border-primary hover:bg-primary/5 dark:border-slate-800 dark:hover:bg-primary/10"
              >
                <div className="bg-primary/10 p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                  <FileStack className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-slate-900 dark:text-white text-base text-primary">عرض كشف كامل للطباعة</p>
                  <p className="text-xs text-slate-500 mt-1">فتح كافة الحركات (12,000+) في صفحة مستقلة للطباعة فوراً.</p>
                </div>
              </button>
            </div>

            <div className="mt-8 flex justify-center border-t pt-4 border-slate-100 dark:border-slate-900">
              <button
                type="button"
                className="text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                onClick={() => setOpen(false)}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
