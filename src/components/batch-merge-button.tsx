"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { Loader2 } from "lucide-react";

export function BatchMergeButton({ label = "دمج دفعة" }: { label?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button 
      type="submit" 
      disabled={pending} 
      className="h-9 text-xs flex items-center gap-2"
    >
      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      {pending ? "جاري الدمج..." : label}
    </Button>
  );
}
