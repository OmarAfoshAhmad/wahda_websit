"use client";

import { useState, useTransition } from "react";
import { Shield, ShieldOff, Loader2 } from "lucide-react";
import { toggleFacilityAdmin } from "@/app/actions/facility";

interface Props {
  facilityId: string;
  isAdmin: boolean;
  facilityName: string;
}

export function FacilityToggleAdminButton({ facilityId, isAdmin, facilityName }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleToggle = () => {
    const msg = isAdmin
      ? `هل تريد إزالة صلاحيات المشرف من "${facilityName}"؟`
      : `هل تريد منح صلاحيات المشرف لـ "${facilityName}"؟`;
    if (!confirm(msg)) return;

    setError(null);
    startTransition(async () => {
      const result = await toggleFacilityAdmin(facilityId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        disabled={pending}
        title={isAdmin ? "إزالة صلاحية الأدمن" : "منح صلاحية الأدمن"}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          isAdmin
            ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-amber-600 dark:hover:text-amber-400"
        }`}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isAdmin ? (
          <Shield className="h-3.5 w-3.5" />
        ) : (
          <ShieldOff className="h-3.5 w-3.5" />
        )}
      </button>
      {error && (
        <div className="absolute left-0 top-9 z-10 w-48 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-2.5 py-1.5 text-xs font-bold text-red-700 dark:text-red-400 shadow-md">
          {error}
        </div>
      )}
    </div>
  );
}
