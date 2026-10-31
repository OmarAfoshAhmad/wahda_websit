"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { cancelPharmacyDispenses } from "@/app/actions/pharmacy";
import { DispenseRow, type DispenseRowData } from "./dispense-row";

/** قائمة الحركات مع تحديد متعدد وإلغاء جماعي (حذف ناعم: يبقى السجل ملغى مع السبب). */
export function DispenseList({ rows }: { rows: DispenseRowData[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const cancellable = rows.filter((row) => row.canCancel);
  const allSelected = cancellable.length > 0 && cancellable.every((row) => selected.has(row.id));

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const cancelSelected = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await cancelPharmacyDispenses([...selected], reason);
      if ("error" in result && result.error) { setMessage({ tone: "error", text: result.error }); return; }
      if (!("cancelled" in result) || !result.failed) return;
      const names = new Map(rows.map((row) => [row.id, row.beneficiary]));
      setMessage({
        tone: result.failed.length ? "error" : "ok",
        text: `أُلغيت ${result.cancelled} حركة.` + (result.failed.length ? ` تعذر إلغاء ${result.failed.length}: ` + result.failed.map((item) => `${names.get(item.id) ?? item.id} (${item.error})`).join("، ") : ""),
      });
      setSelected(new Set(result.failed.map((item) => item.id)));
      setReason("");
      router.refresh();
    });
  };

  return (
    <>
      {cancellable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-900/50">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(cancellable.map((row) => row.id)))} className="h-4 w-4 accent-teal-600" />
            تحديد كل القابل للإلغاء في الصفحة
          </label>
          {selected.size > 0 && (
            <>
              <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="سبب الإلغاء" aria-label="سبب الإلغاء الجماعي" className="h-9 min-w-48 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
              <button type="button" onClick={cancelSelected} disabled={pending || reason.trim().length < 3} className="inline-flex h-9 items-center gap-1 rounded-md bg-rose-600 px-3 text-sm font-bold text-white disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} إلغاء المحدد ({selected.size})
              </button>
            </>
          )}
        </div>
      )}
      {selected.size > 0 && <p className="bg-amber-50 px-4 py-1.5 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">الإلغاء حذف ناعم: تبقى الحركات في السجل بحالة «ملغاة» مع السبب، وتُعاد حصة الشركة إلى السقف.</p>}
      {message && <p role={message.tone === "error" ? "alert" : "status"} className={`px-4 py-2 text-sm font-bold ${message.tone === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{message.text}</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => <DispenseRow key={row.id} row={row} selected={selected.has(row.id)} onToggle={row.canCancel ? () => toggle(row.id) : undefined} />)}
      </ul>
    </>
  );
}
