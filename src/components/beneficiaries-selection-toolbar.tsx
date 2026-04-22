"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";

type Props = {
  canExport: boolean;
  exportBaseHref: string;
};

const STORAGE_KEY = "beneficiaries:selected:v1";

function readSelectedFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v)).filter(Boolean);
  } catch {
    return [];
  }
}

function writeSelectedToStorage(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function BeneficiariesSelectionToolbar({ canExport, exportBaseHref }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const applyCheckedState = () => {
      const selectedSet = new Set(readSelectedFromStorage());
      const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="ids"][value]');
      checkboxes.forEach((box) => {
        if (box.disabled) return;
        box.checked = selectedSet.has(box.value);
      });
      setSelectedIds(Array.from(selectedSet));
    };

    const handleCheckboxChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (!target || target.type !== "checkbox" || target.name !== "ids" || !target.value) return;

      const current = new Set(readSelectedFromStorage());
      if (target.checked) {
        current.add(target.value);
      } else {
        current.delete(target.value);
      }
      const next = Array.from(current);
      writeSelectedToStorage(next);
      setSelectedIds(next);
    };

    applyCheckedState();
    document.addEventListener("change", handleCheckboxChange);

    return () => {
      document.removeEventListener("change", handleCheckboxChange);
    };
  }, []);

  const selectedCount = selectedIds.length;

  const exportSelectedHref = useMemo(() => {
    const base = exportBaseHref.includes("?") ? exportBaseHref : `${exportBaseHref}?`;
    const separator = base.endsWith("?") || base.endsWith("&") ? "" : "&";
    const idsParam = encodeURIComponent(selectedIds.join(","));
    return `${base}${separator}ids=${idsParam}`;
  }, [exportBaseHref, selectedIds]);

  const clearSelection = () => {
    writeSelectedToStorage([]);
    setSelectedIds([]);
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="ids"][value]');
    checkboxes.forEach((box) => {
      box.checked = false;
    });
  };

  if (!canExport) return null;

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
      <a
        href={selectedCount > 0 ? exportSelectedHref : undefined}
        target="_blank"
        aria-disabled={selectedCount === 0}
        className={`inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md px-4 text-sm font-black text-white! transition-colors sm:w-auto ${selectedCount > 0
          ? "bg-emerald-600 hover:bg-emerald-700 dark:hover:bg-emerald-600"
          : "cursor-not-allowed bg-slate-400"}`}
      >
        <Download className="h-4 w-4" />
        تصدير المحدد ({selectedCount})
      </a>

      <button
        type="button"
        onClick={clearSelection}
        aria-label="إلغاء التحديد"
        title="إلغاء التحديد"
        className="inline-flex h-10 w-10 shrink-0 self-end items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 sm:self-auto"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
