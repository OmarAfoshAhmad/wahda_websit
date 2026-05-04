"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  logId: string;
  rolledBack?: boolean;
  allowSelective?: boolean;
};

export function BulkBeneficiaryRollbackButton({ logId, rolledBack, allowSelective = false }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(Boolean(rolledBack));
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const postRollback = async (targets: string[] = []) => {
    const res = await fetch(`/api/beneficiaries/bulk-audit-rollback/${logId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "فشل التراجع");
      return;
    }
    if (typeof data.revertedCount === "number") {
      setInfo(`تم التراجع عن ${data.revertedCount.toLocaleString("ar-LY")} عنصر`);
    }
    if (data.fullyReverted) {
      setDone(true);
    }
    router.refresh();
  };

  const handleRollback = async () => {
    if (loading || done) return;
    if (!window.confirm("هل أنت متأكد من التراجع عن هذه العملية الجماعية؟")) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      await postRollback();
    } catch {
      setError("خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectiveRollback = async () => {
    if (loading || done) return;
    const raw = window.prompt("أدخل المعرفات أو أرقام البطاقات المراد التراجع عنها، مفصولة بفاصلة");
    if (!raw) return;

    const targets = [...new Set(raw.split(/[،,\n]+/).map((v) => v.trim()).filter(Boolean))];
    if (targets.length === 0) return;

    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await postRollback(targets);
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
        title="التراجع عن العملية الجماعية"
      >
        {loading ? "جارٍ التراجع..." : "↩ تراجع"}
      </button>
      {allowSelective ? (
        <button
          type="button"
          onClick={handleSelectiveRollback}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-50"
          title="تراجع انتقائي لعناصر محددة"
        >
          {loading ? "جارٍ التنفيذ..." : "↩ تراجع انتقائي"}
        </button>
      ) : null}
      {error && <span className="text-xs font-bold text-red-600 dark:text-red-400">{error}</span>}
      {info && <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{info}</span>}
    </>
  );
}
