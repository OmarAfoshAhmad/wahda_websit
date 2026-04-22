"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
  error?: string | null;
}

const variantClass: Record<NonNullable<ConfirmationModalProps["variant"]>, string> = {
  danger: "bg-red-600 hover:bg-red-700",
  warning: "bg-amber-500 hover:bg-amber-600",
  info: "bg-blue-600 hover:bg-blue-700",
};

// دالة مساعدة لجلب العناصر القابلة للتركيز داخل حاوية
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  variant = "danger",
  isLoading = false,
  error,
}: ConfirmationModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const priorFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descId = React.useId();

  // حفظ العنصر المُركَّز قبل الفتح، واستعادة التركيز عند الإغلاق
  React.useEffect(() => {
    if (isOpen) {
      priorFocusRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        const focusable = dialogRef.current ? getFocusable(dialogRef.current) : [];
        focusable[0]?.focus();
      });
    } else {
      priorFocusRef.current?.focus();
      priorFocusRef.current = null;
    }
  }, [isOpen]);

  // مصيدة التركيز + إغلاق بـ Escape
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && !isLoading) {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = getFocusable(dialogRef.current);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };

  if (!isOpen) return null;

  return (
    // Backdrop — ينغلق بالنقر خارج النافذة
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget && !isLoading) onClose(); }}
    >
      {/* نافذة الحوار */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg animate-in fade-in zoom-in duration-200 dark:bg-slate-900 dark:ring-1 dark:ring-slate-700 sm:p-6"
      >
        <h3 id={titleId} className="mb-2 text-lg font-bold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        <p id={descId} className="mb-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {description}
        </p>

        {error && (
          <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="w-full rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 sm:w-auto"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 sm:w-auto ${variantClass[variant]}`}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
