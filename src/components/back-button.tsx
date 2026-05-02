"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function BackButton() {
  const router = useRouter();
  
  return (
    <Button 
      type="button" 
      onClick={() => router.back()} 
      className="bg-slate-800 text-white px-6 py-2 rounded-lg font-bold"
    >
      الرجوع للنظام
    </Button>
  );
}
