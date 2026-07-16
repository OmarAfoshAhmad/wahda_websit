"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RotateCcw, RotateCw, Loader2 } from "lucide-react";

export function AuditRowActions({ logId, action, historyState }: { logId: string; action: string; historyState?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"undo" | "redo" | null>(null);
  const [error, setError] = useState("");
  const reversible = action === "EDIT_TRANSACTION";
  const isUndone = historyState === "undone";

  const run = async (mode: "undo" | "redo") => {
    if (!window.confirm(mode === "undo" ? "هل تريد التراجع عن هذه العملية؟" : "هل تريد إعادة تطبيق هذه العملية؟")) return;
    setLoading(mode);
    setError("");
    try {
      const response = await fetch(`/api/admin/audit-log/${encodeURIComponent(logId)}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) setError(data.error ?? "فشل الإجراء");
      else router.refresh();
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex min-w-32 flex-col items-start gap-1">
      <a href={`/api/export/audit-log?log_id=${encodeURIComponent(logId)}`} className="inline-flex items-center gap-1 rounded border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50">
        <Download className="h-3 w-3" /> تقرير XLSX
      </a>
      {reversible && !isUndone ? (
        <button disabled={loading !== null} onClick={() => run("undo")} className="inline-flex items-center gap-1 rounded border border-amber-200 px-2 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-50">
          {loading === "undo" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} تراجع
        </button>
      ) : null}
      {reversible && isUndone ? (
        <button disabled={loading !== null} onClick={() => run("redo")} className="inline-flex items-center gap-1 rounded border border-blue-200 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          {loading === "redo" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />} إعادة
        </button>
      ) : null}
      {error ? <span className="max-w-48 text-[10px] text-red-600">{error}</span> : null}
    </div>
  );
}
