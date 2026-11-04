"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Receipt, Trash2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { getManualDispenseFacilities, manualPharmacyDispense } from "@/app/actions/pharmacy";

type ChronicOption = { id: string; name: string; eligible: boolean; nextAt: string | null };
type Line = { key: number; name: string; chronicDrugId: string; price: string };

const SELECT = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900";
const FILE = "block w-full text-xs file:me-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:font-bold dark:file:bg-slate-800";
let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, name: "", chronicDrugId: "", price: "" });

/**
 * خصم صيدلية يدوي من الإدارة باسم صيدلية محددة: روتيني (أسماء أدوية حرة) أو مزمن (من أدوية المستفيد).
 * الحساب والسقوف وقفل المزمن كما في صرف الصيدلية، والمرفقات اختيارية، والسبب إلزامي (يُحفظ في سجل التدقيق).
 */
export function ManualDispenseForm({ companyId, beneficiaryId, chronic, onDone }: { companyId: string; beneficiaryId: string; chronic: ChronicOption[]; onDone: (message: string, dispenseId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [facilities, setFacilities] = useState<Array<{ id: string; name: string }> | null>(null);
  const [facilityId, setFacilityId] = useState("");
  const [category, setCategory] = useState<"ROUTINE" | "CHRONIC">("ROUTINE");
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open || facilities) return;
    void getManualDispenseFacilities(companyId).then((result) => {
      if (result.error) setError(result.error);
      setFacilities(result.facilities);
    });
  }, [companyId, facilities, open]);

  const total = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.price) || 0), 0), [lines]);
  const update = (key: number, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const submit = (form: HTMLFormElement) => {
    setError("");
    const data = new FormData(form);
    data.set("companyId", companyId);
    data.set("beneficiaryId", beneficiaryId);
    data.set("facilityId", facilityId);
    data.set("category", category);
    data.set("note", note);
    data.set("idempotencyKey", idempotencyKey);
    data.set("items", JSON.stringify(lines.map((line) => ({ name: line.name, chronicDrugId: line.chronicDrugId, price: Number(line.price) }))));
    startBusy(async () => {
      const result = await manualPharmacyDispense(data);
      if ("error" in result && result.error) { setError(result.error); return; }
      if (!("dispenseId" in result) || !result.dispenseId) return;
      const facility = facilities?.find((item) => item.id === facilityId)?.name ?? "";
      setLines([emptyLine()]);
      setNote("");
      form.reset();
      setIdempotencyKey(crypto.randomUUID());
      setOpen(false);
      onDone(`سُجّل الخصم اليدوي باسم ${facility}`, result.dispenseId);
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-teal-300 px-3 py-1.5 text-sm font-bold text-teal-700 hover:bg-teal-50">
        <Receipt className="h-4 w-4" /> خصم يدوي
      </button>
    );
  }

  return (
    <form className="w-full space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50" onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget); }}>
      <p className="text-xs text-slate-500">تُسجَّل الحركة باسم الصيدلية المختارة وبنفس السياسة والسقوف، ويُحفظ اسمك والسبب في سجل التدقيق.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-bold">
          <span>الصيدلية</span>
          <select required value={facilityId} onChange={(event) => setFacilityId(event.target.value)} className={SELECT}>
            <option value="">{facilities ? "اختر الصيدلية" : "جارٍ التحميل…"}</option>
            {facilities?.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold">
          <span>النوع</span>
          <select value={category} onChange={(event) => { setCategory(event.target.value as "ROUTINE" | "CHRONIC"); setLines([emptyLine()]); }} className={SELECT}>
            <option value="ROUTINE">أدوية روتينية</option>
            <option value="CHRONIC" disabled={chronic.length === 0}>أدوية مزمنة{chronic.length === 0 ? " (لا توجد أدوية مرتبطة)" : ""}</option>
          </select>
        </label>
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={line.key} className="flex items-center gap-2">
            <span className="w-5 text-center text-xs font-bold text-slate-500 tabular-nums">{index + 1}</span>
            {category === "ROUTINE" ? (
              <Input required value={line.name} onChange={(event) => update(line.key, { name: event.target.value })} placeholder="اسم الدواء والجرعة" className="h-10 flex-1" aria-label={`اسم الدواء ${index + 1}`} dir="auto" />
            ) : (
              <select required value={line.chronicDrugId} onChange={(event) => update(line.key, { chronicDrugId: event.target.value })} className={`${SELECT} flex-1`} aria-label={`الدواء المزمن ${index + 1}`}>
                <option value="">اختر الدواء</option>
                {chronic.map((drug) => (
                  <option key={drug.id} value={drug.id} disabled={lines.some((other) => other.key !== line.key && other.chronicDrugId === drug.id)}>
                    {drug.name}{drug.eligible ? "" : " (مقفل)"}
                  </option>
                ))}
              </select>
            )}
            <Input required type="number" min="0.01" step="0.01" value={line.price} onChange={(event) => update(line.key, { price: event.target.value })} placeholder="السعر" className="h-10 w-28" dir="ltr" aria-label={`سعر البند ${index + 1}`} />
            <button type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} aria-label="حذف البند" className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" disabled={category === "CHRONIC" && lines.length >= chronic.length} onClick={() => setLines((current) => [...current, emptyLine()])} className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 disabled:opacity-40"><Plus className="h-3 w-3" /> بند آخر</button>
          <span className="text-sm font-black tabular-nums">الإجمالي: {total.toFixed(2)} د.ل</span>
        </div>
        {category === "CHRONIC" && chronic.some((drug) => !drug.eligible) && <p className="text-xs text-amber-700">الدواء المقفل لا يُخصم قبل موعده؛ أعد تفعيله أولًا إن كان صرفًا جزئيًا.</p>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-bold"><span>صورة البطاقة (اختياري)</span><input type="file" name="insuranceCard" accept="image/*,application/pdf" className={FILE} /></label>
        <label className="space-y-1 text-xs font-bold"><span>صورة الوصفة (اختياري)</span><input type="file" name="prescription" accept="image/*,application/pdf" className={FILE} /></label>
      </div>
      <Input required value={note} onChange={(event) => setNote(event.target.value)} placeholder="سبب الخصم اليدوي (إلزامي)" className="h-10" aria-label="سبب الخصم اليدوي" />

      {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={() => { setOpen(false); setError(""); }} className="h-10 border border-slate-300 bg-white px-4 text-slate-700 dark:bg-slate-900 dark:text-slate-200">إلغاء</Button>
        <Button type="submit" disabled={busy || !facilityId || total <= 0} className="h-10 bg-teal-600 px-4 text-white">{busy ? "جارٍ الخصم…" : `خصم ${total.toFixed(2)} د.ل`}</Button>
      </div>
    </form>
  );
}
