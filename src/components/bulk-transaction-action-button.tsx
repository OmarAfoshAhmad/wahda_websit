"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Mode = "cancel" | "rededuct" | "mixed";

function computeMode(types: string[]): Mode {
  const hasCancellation = types.some((t) => t === "CANCELLATION");
  const hasNormal = types.some((t) => t !== "CANCELLATION");

  if (hasCancellation && hasNormal) return "mixed";
  return hasCancellation ? "rededuct" : "cancel";
}

export function BulkTransactionActionButton({
  statusFilter,
  canCancel = false,
  canDelete = false,
}: {
  statusFilter: "all" | "active" | "cancelled" | "cancellation" | "deleted";
  canCancel?: boolean;
  canDelete?: boolean;
}) {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  useEffect(() => {
    const collect = () => {
      const checked = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[data-bulk-tx-checkbox="1"]:checked')
      );
      setSelectedTypes(checked.map((node) => node.dataset.txType ?? ""));
    };

    collect();
    document.addEventListener("change", collect);
    return () => document.removeEventListener("change", collect);
  }, []);

  const count = selectedTypes.length;
  const mode = useMemo(() => computeMode(selectedTypes), [selectedTypes]);
  const hasCorrectedSelected = selectedTypes.some((t) => t === "CANCELLATION");

  const label =
    count === 0
      ? "إلغاء الخصم المحدد"
      : mode === "rededuct"
        ? "إعادة الخصم"
        : mode === "cancel"
          ? "إلغاء الخصم المحدد"
          : "اختر نوعًا واحدًا فقط";

  const disabled = count === 0 || mode === "mixed";

  const clearSelection = () => {
    const checked = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-bulk-tx-checkbox="1"]:checked')
    );
    checked.forEach((input) => {
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    setSelectedTypes([]);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-black text-primary">
        {count}
      </span>

      {statusFilter === "deleted" ? (
        <div className="flex gap-2 items-center">
          <button
            type="submit"
            name="op"
            value="restore_delete"
            disabled={count === 0 || !canDelete}
            className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-3 text-xs font-black text-emerald-800 dark:text-emerald-300 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            استعادة الحركة
          </button>

          {canDelete && (
            <button
              type="submit"
              name="op"
              value="permanent_delete"
              disabled={count === 0}
              className="inline-flex h-8 items-center justify-center rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-3 text-xs font-black text-red-700 dark:text-red-300 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              title="حذف نهائي للحركات المحددة"
              onClick={(e) => {
                if (!confirm("هل أنت متأكد من حذف هذه الحركات نهائياً؟ لا يمكن التراجع عن هذا الإجراء.")) {
                  e.preventDefault();
                }
              }}
            >
              حذف نهائي
            </button>
          )}
        </div>
      ) : (
        <>
          {canCancel && (
            <button
              type="submit"
              name="op"
              value="cancel_or_rededuct"
              disabled={disabled}
              className="inline-flex h-8 items-center justify-center rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 text-xs font-black text-amber-800 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              title={mode === "mixed" ? "لا يمكن تنفيذ الإجراء على حركات عادية ومصححة معًا" : label}
            >
              {label}
            </button>
          )}

          {canDelete && (
            <button
              type="submit"
              name="op"
              value="soft_delete"
              disabled={count === 0 || hasCorrectedSelected}
              className="inline-flex h-8 items-center justify-center rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-3 text-xs font-black text-red-700 dark:text-red-300 transition-colors hover:bg-red-100 dark:hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              title={hasCorrectedSelected ? "لا يمكن حذف حركة مصححة" : "حذف ناعم للحركة"}
            >
              حذف حركة
            </button>
          )}
        </>
      )}

      <button
        type="button"
        onClick={clearSelection}
        disabled={count === 0}
        className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-xs font-black text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        إلغاء التحديد
      </button>

      {/* رابط الوصول السريع للمحذوفات أو العودة لجميع الحركات */}
      {statusFilter === "deleted" ? (
        <Link
          href="/transactions"
          className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-xs font-black text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 mr-auto"
          title="العودة لعرض جميع الحركات"
        >
          الرجوع للحركات
        </Link>
      ) : (
        <Link
          href="?status=deleted"
          className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 dark:border-slate-600 hover:border-red-300 dark:hover:border-red-700 bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/30 px-3 text-xs font-black text-slate-500 dark:text-slate-300 hover:text-red-700 dark:hover:text-red-400 transition-colors mr-auto"
          title="عرض الحركات المحذوفة (المحذوفات)"
        >
          المحذوفات
        </Link>
      )}
    </div>
  );
}
