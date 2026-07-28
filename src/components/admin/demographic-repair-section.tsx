"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runDemographicRepairAction, type DemographicRepairMode } from "@/app/actions/data-hygiene";
import { ConfirmationModal } from "@/components/ui";

export type DemographicRepairRow = {
  id: string;
  name: string;
  cardNumber: string;
  proposedValue: string;
  evidence: string;
};

export function DemographicRepairSection({
  title,
  description,
  companyId,
  mode,
  rows,
}: {
  title: string;
  description: string;
  companyId: string;
  mode: DemographicRepairMode;
  rows: DemographicRepairRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const execute = () => startTransition(async () => {
    const result = await runDemographicRepairAction({ companyId, mode });
    if (!result.success) {
      setMessage(result.error ?? "تعذرت المعالجة");
      return;
    }
    setConfirmOpen(false);
    setMessage(`تم تحديث ${result.processed_count}، وتخطي ${result.skipped_count}، ووجد ${result.conflict_count} تعارض.`);
    router.refresh();
  });

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">{title} ({rows.length})</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">{description}</p>
        </div>
        <button type="button" disabled={pending || rows.length === 0} onClick={() => setConfirmOpen(true)} className="rounded-md bg-[#0f2a4a] px-4 py-2 text-sm font-black text-white disabled:opacity-50">
          {pending ? "جاري التنفيذ..." : "تنفيذ الإصلاح الآمن"}
        </button>
      </div>
      {message && <p className="rounded border border-slate-200 p-2 text-xs dark:border-slate-700">{message}</p>}
      {rows.length === 0 ? <p className="text-sm font-bold text-emerald-600">✓ لا توجد حالات مطابقة موثوقة.</p> : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-b text-right"><th className="p-2">الاسم</th><th className="p-2">الحالي</th><th className="p-2">المقترح</th><th className="p-2">الدليل</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className="border-b dark:border-slate-800"><td className="p-2 font-bold">{row.name}</td><td className="p-2 font-mono text-xs">{row.cardNumber}</td><td className="p-2 font-mono text-xs text-emerald-600">{row.proposedValue}</td><td className="p-2 text-xs text-slate-500">{row.evidence}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <ConfirmationModal isOpen={confirmOpen} onClose={() => !pending && setConfirmOpen(false)} onConfirm={execute} title={title} description={`سيتم تطبيق ${rows.length} اقتراح موثوق على الشركة المحددة فقط، مع منع تعارض أرقام البطاقات وتسجيل العملية.`} confirmLabel="نعم، نفذ" cancelLabel="إلغاء" variant="warning" isLoading={pending} error={null} />
    </section>
  );
}
