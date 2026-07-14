"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  jobId: string;
}

export function ImportRollbackButton({ jobId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRollback = async () => {
    if (loading || done) return;
    if (!window.confirm("هل أنت متأكد من التراجع عن هذا الاستيراد؟ سيتم حذف المستفيدين المضافين واستعادة البيانات القديمة.")) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/import-jobs/${jobId}/rollback`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "فشل التراجع");
      } else {
        setDone(true);
        router.refresh();
      }
    } catch {
      setError("خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 text-xs font-bold text-green-700 dark:text-green-400">
        ✓ تم التراجع
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleRollback}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 text-xs font-bold text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
        title="التراجع عن هذا الاستيراد"
      >
        {loading ? "جارٍ التراجع..." : "↩ تراجع"}
      </button>
      {error && (
        <span className="text-xs font-bold text-red-600 dark:text-red-400">{error}</span>
      )}
    </>
  );
}
