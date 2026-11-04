"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarClock, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { listFacilityNameSuggestions, setChronicLastDispenses } from "@/app/actions/pharmacy-beneficiaries";

type Drug = { id: string; name: string; manualAt: string | null; manualFacility: string | null };
type Row = { selected: boolean; date: string | null; facility: string | null };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * تسجيل آخر صرف (بدون تفاصيل مالية) لأدوية المستفيد المزمنة دفعة واحدة: المرفق والتاريخ يُدخلان مرة
 * ويُطبَّقان على كل الأدوية المختارة، ويمكن تغيير مرفق أو تاريخ دواء بعينه. المرفق بإكمال تلقائي.
 */
export function ChronicLastDispenseForm({ companyId, beneficiaryId, drugs, onDone }: { companyId: string; beneficiaryId: string; drugs: Drug[]; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [facility, setFacility] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();

  useEffect(() => {
    if (open) void listFacilityNameSuggestions(companyId).then(setSuggestions);
  }, [companyId, open]);

  const rowOf = (id: string): Row => rows[id] ?? { selected: true, date: null, facility: null };
  const setRow = (id: string, change: Partial<Row>) => setRows((current) => ({ ...current, [id]: { ...rowOf(id), ...change } }));
  const chosen = drugs.filter((drug) => rowOf(drug.id).selected);
  const resolved = chosen.map((drug) => ({ linkId: drug.id, date: rowOf(drug.id).date ?? date, facility: rowOf(drug.id).facility ?? facility }));
  const valid = resolved.length > 0 && resolved.every((entry) => entry.date && entry.facility.trim().length >= 2);

  const submit = () => {
    setError("");
    startBusy(async () => {
      const result = await setChronicLastDispenses(beneficiaryId, resolved);
      if (result.error) { setError(result.error); return; }
      setOpen(false);
      setRows({});
      onDone(`سُجّل آخر صرف لـ ${resolved.length} دواء`);
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-bold hover:bg-slate-50 dark:border-slate-600">
        <CalendarClock className="h-3 w-3" /> تسجيل آخر صرف
      </button>
    );
  }

  const listId = `facility-names-${beneficiaryId}`;
  return (
    <form className="w-full space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-black text-slate-600 dark:text-slate-300">آخر صرف (بدون تفاصيل مالية، يقفل الدواء حتى موعده)</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="p-1 text-slate-400"><X className="h-4 w-4" /></button>
      </div>
      <datalist id={listId}>{suggestions.map((name) => <option key={name} value={name} />)}</datalist>
      <div className="flex flex-wrap gap-2">
        <Input autoFocus value={facility} onChange={(event) => setFacility(event.target.value)} list={listId} placeholder="المرفق الذي صرف (لكل الأدوية)" className="h-10 min-w-44 flex-1" aria-label="المرفق لكل الأدوية" dir="auto" />
        <Input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} className="h-10 w-40" dir="ltr" aria-label="التاريخ لكل الأدوية" />
      </div>

      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {drugs.map((drug) => {
          const row = rowOf(drug.id);
          return (
            <li key={drug.id} className="space-y-1 py-2">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input type="checkbox" checked={row.selected} onChange={(event) => setRow(drug.id, { selected: event.target.checked })} className="h-4 w-4 accent-teal-600" />
                <span dir="auto">{drug.name}</span>
              </label>
              {row.selected && (row.facility !== null || row.date !== null ? (
                <div className="flex flex-wrap gap-1 ps-6">
                  <Input value={row.facility ?? facility} onChange={(event) => setRow(drug.id, { facility: event.target.value })} list={listId} className="h-8 min-w-36 flex-1 text-xs" aria-label={`مرفق ${drug.name}`} dir="auto" />
                  <Input type="date" value={row.date ?? date} max={today()} onChange={(event) => setRow(drug.id, { date: event.target.value })} className="h-8 w-36 text-xs" dir="ltr" aria-label={`تاريخ ${drug.name}`} />
                  <button type="button" onClick={() => setRow(drug.id, { facility: null, date: null })} className="text-xs font-bold text-slate-500 underline">مثل الكل</button>
                </div>
              ) : (
                <p className="ps-6 text-xs text-slate-500">
                  {facility || "—"} · {date || "—"}{" "}
                  <button type="button" onClick={() => setRow(drug.id, { facility, date })} className="font-bold text-teal-700 underline">تغيير لهذا الدواء</button>
                </p>
              ))}
            </li>
          );
        })}
      </ul>

      {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !valid} className="h-10 bg-teal-600 px-4 text-white">{busy ? "جارٍ الحفظ…" : `حفظ (${chosen.length})`}</Button>
      </div>
    </form>
  );
}
