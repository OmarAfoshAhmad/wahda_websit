"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ChevronLeft, KeyRound, Loader2, LockKeyhole, Pause, Pencil, Phone, Pill, Play, Plus, Printer, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import {
  addChronicDrug,
  getPharmacyBeneficiaryDetails,
  listPharmacyBeneficiaries,
  resetFamilyPassword,
  searchDrugCatalog,
  setBeneficiaryPhone,
  updateChronicDrug,
} from "@/app/actions/pharmacy-beneficiaries";

type Row = {
  id: string;
  name: string;
  card_number: string;
  phone_number: string | null;
  status: string;
  has_password: boolean;
  chronic_count: number;
  is_account_holder: boolean;
};
type Details = Extract<Awaited<ReturnType<typeof getPharmacyBeneficiaryDetails>>, { beneficiary: unknown }>;

const CATEGORY: Record<string, string> = { ROUTINE: "روتيني", CHRONIC: "مزمن", CHEMICAL: "أورام" };
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" });
const money = (value: number) => `${value.toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} د.ل`;

/** مستفيدو الشركة في الصيدلية للإدارة: بحث، ثم نافذة تفاصيل فيها الهاتف وكلمة مرور الأسرة والأدوية المزمنة وسجل الصرف. */
export function PharmacyBeneficiariesPanel({ companyId }: { companyId: string; canEdit?: boolean }) {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const apply = useCallback((result: Awaited<ReturnType<typeof listPharmacyBeneficiaries>>) => {
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setRows(result.items);
    setTotal(result.total);
    setPageSize(result.pageSize);
  }, []);
  const reload = useCallback(async () => apply(await listPharmacyBeneficiaries(companyId, applied, page)), [apply, companyId, applied, page]);

  useEffect(() => {
    let cancelled = false;
    listPharmacyBeneficiaries(companyId, applied, page).then((result) => { if (!cancelled) apply(result); });
    return () => { cancelled = true; };
  }, [apply, companyId, applied, page]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card className="space-y-3 p-3 sm:p-4">
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setLoading(true); setPage(1); setApplied(query); }}>
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="الاسم أو رقم البطاقة أو الرقم الوظيفي" className="h-11 pr-9" aria-label="بحث في المستفيدين" />
        </div>
        <Button type="submit" className="h-11 bg-teal-600 px-5 text-white hover:bg-teal-700">بحث</Button>
      </form>
      {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">لا يوجد مستفيدون مطابقون</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setOpenId(row.id)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-start transition hover:border-teal-400 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${row.is_account_holder ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}><UserRound className="h-5 w-5" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black text-slate-900 dark:text-white">{row.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    <span className="font-mono" dir="ltr">{row.card_number}</span>
                    <span>{row.is_account_holder ? "صاحب البطاقة" : "فرد من الأسرة"}</span>
                    {row.status === "SUSPENDED" && <span className="font-bold text-rose-600">موقوف</span>}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold">
                    {row.is_account_holder && (row.phone_number
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300"><Phone className="h-3 w-3" /><span dir="ltr">{row.phone_number}</span></span>
                      : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">بلا هاتف</span>)}
                    {row.is_account_holder && row.has_password && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800"><ShieldCheck className="h-3 w-3" /> مسجّل في البوابة</span>}
                    {row.chronic_count > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300"><Pill className="h-3 w-3" /> {row.chronic_count} مزمن</span>}
                  </span>
                </span>
                <ChevronLeft className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total.toLocaleString("en")} مستفيد</span>
        <span className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => value - 1); }} className="h-8 px-3 text-xs">السابق</Button>
          <span className="tabular-nums">{page} / {pages}</span>
          <Button type="button" variant="outline" disabled={page >= pages || loading} onClick={() => { setLoading(true); setPage((value) => value + 1); }} className="h-8 px-3 text-xs">التالي</Button>
        </span>
      </div>

      {openId && <BeneficiaryDrawer key={openId} companyId={companyId} beneficiaryId={openId} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </Card>
  );
}

function BeneficiaryDrawer({ companyId, beneficiaryId, onClose, onChanged }: { companyId: string; beneficiaryId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, startBusy] = useTransition();
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [drugName, setDrugName] = useState("");
  const [drugNotes, setDrugNotes] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string }>>([]);
  const [editingNotes, setEditingNotes] = useState<{ id: string; value: string } | null>(null);

  const apply = useCallback((result: Awaited<ReturnType<typeof getPharmacyBeneficiaryDetails>>) => {
    if ("error" in result && result.error) setError(result.error);
    else setData(result as Details);
  }, []);
  const reload = useCallback(async () => apply(await getPharmacyBeneficiaryDetails(beneficiaryId)), [apply, beneficiaryId]);
  useEffect(() => {
    let cancelled = false;
    getPharmacyBeneficiaryDetails(beneficiaryId).then((result) => { if (!cancelled) apply(result); });
    return () => { cancelled = true; };
  }, [apply, beneficiaryId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (drugName.trim().length < 2) return;
    const timer = setTimeout(() => { void searchDrugCatalog(companyId, drugName).then(setSuggestions); }, 250);
    return () => clearTimeout(timer);
  }, [companyId, drugName]);

  const run = (action: () => Promise<{ error?: string; success?: boolean }>, done: string) => {
    setError("");
    setNotice("");
    startBusy(async () => {
      const result = await action();
      if (result.error) { setError(result.error); return; }
      await reload();
      setNotice(done);
      onChanged();
    });
  };

  const canEdit = data?.canEdit ?? false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="تفاصيل المستفيد" onClick={(event) => event.stopPropagation()} className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-slate-50 shadow-xl dark:bg-slate-950">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black">{data?.beneficiary.name ?? "…"}</h2>
            {data && <p className="text-xs text-slate-500"><span className="font-mono" dir="ltr">{data.beneficiary.card_number}</span> · {data.beneficiary.company}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-4 p-4">
          {notice && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}
          {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
          {!data && !error && <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>}

          {data && (
            <>
              {/* الدخول للبوابة */}
              <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <h3 className="text-sm font-black">الدخول للبوابة</h3>
                {data.account && !data.account.isSelf && <p className="text-xs text-slate-500">يدخل عبر حساب صاحب البطاقة: <strong>{data.account.name}</strong></p>}
                {data.account && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">هاتف صاحب البطاقة (يصله رمز التحقق):</span>
                      {phoneDraft === null ? (
                        <span className="flex items-center gap-2">
                          {data.account.phone ? <span className="font-mono font-bold" dir="ltr">{data.account.phone}</span> : <span className="text-sm font-bold text-amber-700">لا يوجد</span>}
                          {canEdit && <button type="button" onClick={() => setPhoneDraft(data.account!.phone ?? "")} className="inline-flex items-center gap-1 rounded-md border border-teal-300 px-2 py-1 text-xs font-bold text-teal-700 hover:bg-teal-50"><Pencil className="h-3 w-3" /> {data.account.phone ? "تغيير" : "إضافة"}</button>}
                        </span>
                      ) : (
                        <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); run(() => setBeneficiaryPhone(data.account!.id, phoneDraft), "حُفظ الهاتف"); setPhoneDraft(null); }}>
                          <Input autoFocus value={phoneDraft} onChange={(event) => setPhoneDraft(event.target.value)} placeholder="0912345678" dir="ltr" inputMode="tel" className="h-9 w-36" aria-label="رقم الهاتف" />
                          <Button type="submit" disabled={busy} className="h-9 bg-teal-600 px-3 text-xs text-white">حفظ</Button>
                          <button type="button" onClick={() => setPhoneDraft(null)} aria-label="إلغاء" className="p-1 text-slate-400"><X className="h-4 w-4" /></button>
                        </form>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">كلمة مرور الأسرة:</span>
                      <span className="flex items-center gap-2">
                        {data.account.hasPassword ? <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700"><ShieldCheck className="h-4 w-4" /> مُنشأة</span> : <span className="text-sm text-slate-500">لم يسجّل بعد</span>}
                        {canEdit && data.account.hasPassword && (
                          <button type="button" disabled={busy} onClick={() => { if (window.confirm("مسح كلمة مرور الأسرة؟ سيسجل صاحب البطاقة من جديد برمز التحقق.")) run(() => resetFamilyPassword(data.account!.id), "مُسحت كلمة مرور الأسرة"); }} className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50"><KeyRound className="h-3 w-3" /> مسح</button>
                        )}
                      </span>
                    </div>
                  </>
                )}
              </section>

              {/* الأدوية المزمنة */}
              <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <h3 className="text-sm font-black">الأدوية المزمنة <span className="font-normal text-slate-500">· كل دواء مرة كل {data.chronicIntervalDays} يومًا</span></h3>
                {data.chronic.length === 0 && <p className="text-sm text-slate-500">لا توجد أدوية مزمنة مرتبطة.</p>}
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.chronic.map((drug) => (
                    <li key={drug.id} className="space-y-1 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold" dir="auto">{drug.name}</p>
                          <p className="text-xs text-slate-500">{drug.lastAt ? `آخر صرف ${day(drug.lastAt)} · ${drug.lastFacility}` : "لم يُصرف بعد"}</p>
                        </div>
                        {drug.eligible
                          ? <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">متاح الآن</span>
                          : <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800"><LockKeyhole className="h-3 w-3" /> من {drug.nextAt ? day(drug.nextAt) : "—"}</span>}
                      </div>
                      {editingNotes?.id === drug.id ? (
                        <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); run(() => updateChronicDrug(drug.id, { notes: editingNotes.value }), "حُفظت الملاحظة"); setEditingNotes(null); }}>
                          <Input autoFocus value={editingNotes.value} onChange={(event) => setEditingNotes({ id: drug.id, value: event.target.value })} placeholder="الجرعة أو التكرار (مثال: 1×2)" className="h-9 flex-1" aria-label="ملاحظة الدواء" />
                          <Button type="submit" disabled={busy} className="h-9 bg-teal-600 px-3 text-xs text-white">حفظ</Button>
                          <button type="button" onClick={() => setEditingNotes(null)} aria-label="إلغاء" className="p-1 text-slate-400"><X className="h-4 w-4" /></button>
                        </form>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-slate-600 dark:text-slate-300" dir="auto">{drug.notes || "بلا ملاحظات"}</span>
                          {canEdit && (
                            <span className="flex gap-1">
                              <button type="button" onClick={() => setEditingNotes({ id: drug.id, value: drug.notes ?? "" })} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-bold hover:bg-slate-50 dark:border-slate-600"><Pencil className="h-3 w-3" /> ملاحظة</button>
                              <button type="button" disabled={busy} onClick={() => { if (window.confirm(`إيقاف ${drug.name}؟ لن يظهر للصيدليات، ويبقى سجل صرفه.`)) run(() => updateChronicDrug(drug.id, { active: false }), `أُوقف ${drug.name}`); }} className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50"><Pause className="h-3 w-3" /> إيقاف</button>
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {canEdit && (
                  <form className="space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50" onSubmit={(event) => { event.preventDefault(); run(() => addChronicDrug(beneficiaryId, drugName, drugNotes), `أُضيف ${drugName}`); setDrugName(""); setDrugNotes(""); setSuggestions([]); }}>
                    <p className="text-xs font-black text-slate-600 dark:text-slate-300">إضافة دواء مزمن</p>
                    <Input value={drugName} onChange={(event) => setDrugName(event.target.value)} list={`drugs-${beneficiaryId}`} placeholder="اسم الدواء والجرعة (مثال: Concor 5mg)" className="h-10" aria-label="اسم الدواء" dir="auto" />
                    <datalist id={`drugs-${beneficiaryId}`}>{drugName.trim().length >= 2 && suggestions.map((drug) => <option key={drug.id} value={drug.name} />)}</datalist>
                    <div className="flex gap-2">
                      <Input value={drugNotes} onChange={(event) => setDrugNotes(event.target.value)} placeholder="التكرار أو الملاحظات (اختياري)" className="h-10 flex-1" aria-label="ملاحظات الدواء" />
                      <Button type="submit" disabled={busy || drugName.trim().length < 2} className="h-10 bg-teal-600 px-3 text-white"><Plus className="h-4 w-4" /> إضافة</Button>
                    </div>
                  </form>
                )}

                {data.inactive.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-bold text-slate-500">أدوية موقوفة ({data.inactive.length})</summary>
                    <ul className="mt-1 space-y-1">
                      {data.inactive.map((drug) => (
                        <li key={drug.id} className="flex items-center justify-between gap-2 text-slate-500">
                          <span dir="auto">{drug.name} · أُوقف {day(drug.stoppedAt)}</span>
                          {canEdit && <button type="button" disabled={busy} onClick={() => run(() => updateChronicDrug(drug.id, { active: true }), `أُعيد ${drug.name}`)} className="inline-flex items-center gap-1 rounded-md border border-teal-300 px-2 py-0.5 text-xs font-bold text-teal-700"><Play className="h-3 w-3" /> إعادة</button>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>

              {/* سجل الصرف */}
              <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <h3 className="text-sm font-black">آخر ما صُرف له</h3>
                {data.dispenses.length === 0 ? <p className="text-sm text-slate-500">لم يُصرف له شيء بعد.</p> : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.dispenses.map((dispense) => (
                      <li key={dispense.id} className={`flex items-center justify-between gap-2 py-2 text-sm ${dispense.cancelled ? "opacity-50" : ""}`}>
                        <span className="min-w-0">
                          <span className="block font-bold">{CATEGORY[dispense.category]} · {dispense.items} بند{dispense.cancelled ? " · ملغى" : ""}</span>
                          <span className="block text-xs text-slate-500">{dispense.facility} · {day(dispense.createdAt)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-end text-xs"><strong className="block text-sm tabular-nums">{money(dispense.gross)}</strong>شركة {money(dispense.company)}</span>
                          <a href={`/admin/pharmacy-services/transactions/${dispense.id}/print`} target="_blank" rel="noopener noreferrer" aria-label="طباعة الفاتورة" title="طباعة الفاتورة" className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-600"><Printer className="h-4 w-4" /></a>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {!canEdit && <p className="text-xs text-slate-500">للتعديل تحتاج صلاحية «تعديل المستفيدين».</p>}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
