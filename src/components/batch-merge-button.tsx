"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { Loader2 } from "lucide-react";

export function BatchMergeButton({ label = "دمج دفعة", disabled = false }: { label?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button 
      type="submit" 
      disabled={pending || disabled}
      className="h-10 min-w-36 text-xs flex items-center justify-center gap-2"
    >
      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
      {pending ? "جاري الدمج..." : label}
    </Button>
  );
}
