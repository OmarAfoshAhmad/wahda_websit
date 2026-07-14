"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function BackButton({ fallbackRoute = "/dashboard" }: { fallbackRoute?: string }) {
  const router = useRouter();
  
  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      window.close(); // إذا كانت في نافذة جديدة (مثل صفحة الطباعة) نغلقها
      // في حال لم تُغلق النافذة (متصفحات تمنع الإغلاق)، نوجه للرئيسية
      setTimeout(() => router.push(fallbackRoute), 100);
    }
  };

  return (
    <Button 
      type="button" 
      onClick={handleBack} 
      className="bg-slate-800 text-white px-6 py-2 rounded-lg font-bold"
    >
      الرجوع للنظام
    </Button>
  );
}
