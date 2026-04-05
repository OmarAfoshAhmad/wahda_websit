"use client";

import { useState, useTransition, ReactNode } from "react";
import { Badge, Button } from "@/components/ui";
import { ignoreDuplicatePairAction } from "@/app/actions/beneficiary";
import { useToast } from "@/components/toast";

type DuplicateSameNameGroupProps = {
  nameKey: string;
  name: string;
  membersCount: number;
  hasBirthDateConflict: boolean;
  hasMissingBirthDate: boolean;
  memberIds: string[];
  children: ReactNode;
};

export function DuplicateSameNameGroup({
  name,
  membersCount,
  hasBirthDateConflict,
  hasMissingBirthDate,
  memberIds,
  children,
}: DuplicateSameNameGroupProps) {
  const [hidden, setHidden] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { toast, success, error } = useToast();

  if (hidden) return null;

  function handleIgnore() {
    startTransition(async () => {
      const fd = new FormData();
      for (const id of memberIds) {
        fd.append("ids", id);
      }
      const res = await ignoreDuplicatePairAction(fd);
      if (!res?.error) {
        success("تم تعليم السجلين كأشخاص مختلفين بنجاح");
        setHidden(true);
      } else {
        error(res.error);
      }
    });
  }

  return (
    <div
      className={`rounded-md border p-3 ${
        hasBirthDateConflict
          ? "border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/10"
          : "border-slate-200 dark:border-slate-700"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={hasBirthDateConflict ? "danger" : (hasMissingBirthDate ? "warning" : "default")}>
            {membersCount} سجلات
          </Badge>
          <span className="text-sm font-bold text-slate-900 dark:text-white">{name}</span>
          {hasBirthDateConflict && (
            <span className="text-xs font-black text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-1.5 py-0.5">
              ⚠ تعارض مواليد — أشخاص مختلفون غالباً
            </span>
          )}
          {hasMissingBirthDate && (
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded px-1.5 py-0.5">
              ⚠️ مواليد غير متوفرة لبعض السجلات
            </span>
          )}
        </div>
        <Button
          onClick={handleIgnore}
          disabled={isPending}
          variant="outline"
          className="flex-shrink-0 h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400"
        >
          {isPending ? "جاري الاستبعاد..." : "شخصين مختلفين (استبعاد)"}
        </Button>
      </div>
      {children}
    </div>
  );
}
