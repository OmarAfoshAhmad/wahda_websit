"use client";

import { Button } from "@/components/ui";
import { Download } from "lucide-react";

interface ExportButtonProps {
  searchParams: Record<string, string | undefined>;
}

export function ExportButton({ searchParams }: ExportButtonProps) {
  const handleExport = () => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      // نتجاهل المعرفات الفردية وخصائص التقسيم للصفحات لأن التصدير يجب أن يشمل جميع النتائج المطلوبة
      if (!value || key === "tx_ids" || key === "page" || key === "pageSize") return;
      params.append(key, value);
    });
    
    // فتح الرابط في نافذة جديدة ليبدأ التحميل
    window.open(`/api/export/transactions?${params.toString()}`, "_blank");
  };

  return (
    <Button
      type="button"
      onClick={handleExport}
      title="تصدير Excel"
      className="bg-emerald-600 hover:bg-emerald-700 text-white print:hidden h-9 w-9 px-0 sm:h-10 sm:w-auto sm:px-4 inline-flex items-center justify-center gap-2"
    >
      <Download className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">تصدير Excel</span>
    </Button>
  );
}
