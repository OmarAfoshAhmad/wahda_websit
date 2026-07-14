"use client";

import { ReactNode } from "react";
import { Badge, Button } from "@/components/ui";

type DuplicateSameNameGroupProps = {
  nameKey: string;
  name: string;
  membersCount: number;
  hasBirthDateConflict: boolean;
  memberIds: string[];
  children: ReactNode;
};

export function DuplicateSameNameGroup({
  nameKey: _nameKey,
  name,
  membersCount,
  hasBirthDateConflict,
  memberIds,
  children,
}: DuplicateSameNameGroupProps) {
  const formId = `form-${memberIds[0]}`; // Using the first member ID as unique form identifier

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
          <Badge variant={hasBirthDateConflict ? "danger" : "default"}>
            {membersCount} سجلات
          </Badge>
          <span className="text-sm font-bold text-slate-900 dark:text-white">{name}</span>
          {hasBirthDateConflict && (
            <span className="text-xs font-black text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-1.5 py-0.5">
              ⚠ تعارض مواليد — أشخاص مختلفون غالباً
            </span>
          )}
        </div>
        <Button
          form={formId}
          type="submit"
          className="shrink-0 h-8 px-4 text-xs"
        >
          دمج فردي
        </Button>
      </div>
      {children}
    </div>
  );
}
