"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ChevronLeft, KeyRound, Loader2, LockKeyhole, Pause, Pencil, Phone, Pill, Play, Plus, Printer, Search, ShieldCheck, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";
import {
  addChronicDrug,
  getPharmacyBeneficiaryDetails,
  listPharmacyFamilies,
  type FamilyFilter,
  resetFamilyPassword,
  searchDrugCatalog,
  setBeneficiaryPhone,
  updateChronicDrug,
} from "@/app/actions/pharmacy-beneficiaries";

type FamilyResult = Awaited<ReturnType<typeof listPharmacyFamilies>>;
type Family = FamilyResult["families"][number];
type Details = Extract<Awaited<ReturnType<typeof getPharmacyBeneficiaryDetails>>, { beneficiary: unknown }>;

const CATEGORY: Record<string, string> = { ROUTINE: "روتيني", CHRONIC: "مزمن", CHEMICAL: "أورام" };
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" });
const money = (value: number) => `${value.toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} د.ل`;
const count = (value: number) => value.toLocaleString("en");

const FILTERS: Array<{ id: FamilyFilter; label: string; tone: string }> = [
  { id: "all", label: "كل الأسر", tone: "text-slate-900 dark:text-white" },
  { id: "no_phone", label: "بلا هاتف", tone: "text-amber-700 dark:text-amber-300" },
  { id: "no_portal", label: "غير مسجّلة في البوابة", tone: "text-slate-700 dark:text-slate-300" },
  { id: "chronic", label: "لديها مزمن", tone: "text-teal-700 dark:text-teal-300" },
  { id: "recent", label: "صُرف لها خلال 30 يومًا", tone: "text-emerald-700 dark:text-emerald-300" },
  { id: "never", label: "لم يُصرف لها", tone: "text-slate-500" },
];

/**
 * حالة القائمة في الرابط (q، filter، page، ben): يعمل زر الرجوع ويمكن نسخ الرابط لموظف آخر.
 * history.pushState متكامل مع موجّه Next فيحدّث useSearchParams دون إعادة تحميل الصفحة.
 */
function useListParams() {
  const search = useSearchParams() ?? new URLSearchParams();
  const filter = search.get("filter") as FamilyFilter | null;
  const state = {
    query: search.get("q") ?? "",
    filter: FILTERS.some((item) => item.id === filter) ? (filter as FamilyFilter) : ("all" as FamilyFilter),
    page: Math.max(1, Number(search.get("page")) || 1),
    ben: search.get("ben"),
  };
  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    const params = new URLSearchParams(window.location.search);
    const set = (key: string, value: string | null, empty: string) => (value && value !== empty ? params.set(key, value) : params.delete(key));
    set("q", next.query, "");
    set("filter", next.filter, "all");
    set("page", String(next.page), "1");
    set("ben", next.ben, "");
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  };
  return [state, update] as const;
}

/**
 * مستفيدو الشركة للإدارة مجمّعين بالأسرة: لوحة أرقام تعمل كفلاتر، بحث من الخادم، جدول مضغوط
 * (بطاقات على الجوال) بخمسين أسرة في الصفحة، والضغط على أي فرد يفتح نافذة تفاصيله.
 */
export function PharmacyBeneficiariesPanel({ companyId }: { companyId: string; canEdit?: boolean }) {
  const [params, setParams] = useListParams();
  const [draft, setDraft] = useState(params.query);
  const [result, setResult] = useState<FamilyResult | null>(null);
  const [stats, setStats] = useState<FamilyResult["stats"]>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);
  const requestKey = JSON.stringify([params.query, params.filter, params.page, version]);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    listPharmacyFamilies(companyId, { query: params.query, filter: params.filter, page: params.page }).then((next) => {
      if (cancelled) return;
      setResult(next);
      if (next.stats) setStats(next.stats);
      setLoadedKey(requestKey);
      // عند البحث تُفتح الأسر التي طابقها فرد غير صاحب البطاقة حتى يظهر المطابق مباشرة.
      setExpanded(new Set(next.families.filter((family) => family.members.some((member) => member.matched && member.id !== family.headId)).map((family) => family.key)));
    });
    return () => { cancelled = true; };
  }, [companyId, params.query, params.filter, params.page, requestKey]);

  const families = result?.families ?? [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (result?.pageSize ?? 50)));
  const toggle = (key: string) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const open = (id: string) => setParams({ ben: id });

  return (
    <Card className="space-y-3 p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={params.filter === item.id}
            onClick={() => setParams({ filter: item.id, page: 1 })}
            className={`rounded-xl border p-2.5 text-start transition ${params.filter === item.id ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500 dark:bg-teal-950/40" : "border-slate-200 bg-white hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900"}`}
          >
            <span className={`block text-xl font-black tabular-nums ${item.tone}`}>{stats ? count(stats[item.id]) : "…"}</span>
            <span className="block text-xs font-bold text-slate-500">{item.label}</span>
          </button>
        ))}
      </div>
      {stats && <p className="text-xs text-slate-500">{count(stats.beneficiaries)} مستفيد في {count(stats.all)} أسرة</p>}

      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setParams({ query: draft.trim(), page: 1 }); }}>
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="الاسم بأي ترتيب، رقم البطاقة، الرقم الوظيفي أو الهاتف" className="h-11 pr-9" aria-label="بحث في المستفيدين" />
        </div>
        <Button type="submit" className="h-11 bg-teal-600 px-5 text-white hover:bg-teal-700">بحث</Button>
        {params.query && <Button type="button" variant="outline" className="h-11" onClick={() => { setDraft(""); setParams({ query: "", page: 1 }); }}>مسح</Button>}
      </form>
      {result?.error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{result.error}</p>}

      <div className={`relative ${loading ? "opacity-60" : ""}`}>
        {loading && !result ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>
        ) : families.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">لا توجد أسر مطابقة</p>
        ) : (
          <>
            {/* سطح المكتب: جدول مضغوط */}
            <table className="hidden w-full text-sm md:table">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="w-8 p-2" />
                  <th className="p-2 text-start">صاحب البطاقة</th>
                  <th className="p-2 text-start">رقم البطاقة</th>
                  <th className="p-2 text-center">الأفراد</th>
                  <th className="p-2 text-start">الهاتف</th>
                  <th className="p-2 text-center">البوابة</th>
                  <th className="p-2 text-center">مزمن</th>
                  <th className="p-2 text-start">آخر صرف</th>
                </tr>
              </thead>
              <tbody>
                {families.map((family) => (
                  <FamilyRows key={family.key} family={family} expanded={expanded.has(family.key)} onToggle={() => toggle(family.key)} onOpen={open} />
                ))}
              </tbody>
            </table>
            {/* الجوال: بطاقات */}
            <ul className="space-y-2 md:hidden">
              {families.map((family) => (
                <li key={family.key} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" onClick={() => open(family.headId)} className="block w-full text-start">
                    <span className="block font-black text-slate-900 dark:text-white">{family.name}</span>
                    <span className="font-mono text-xs text-slate-500" dir="ltr">{family.cardNumber}</span>
                  </button>
                  <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-bold">
                    <PhoneBadge phone={family.phone} />
                    {family.hasPassword && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800"><ShieldCheck className="h-3 w-3" /> البوابة</span>}
                    {family.chronicCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-teal-800"><Pill className="h-3 w-3" /> {family.chronicCount} مزمن</span>}
                  </span>
                  {family.members.length > 1 && (
                    <>
                      <button type="button" onClick={() => toggle(family.key)} className="mt-2 text-xs font-bold text-teal-700">
                        {expanded.has(family.key) ? "إخفاء الأفراد" : `+${family.members.length - 1} من الأسرة`}
                      </button>
                      {expanded.has(family.key) && (
                        <ul className="mt-1 space-y-1 border-t border-slate-100 pt-1 dark:border-slate-800">
                          {family.members.filter((member) => member.id !== family.headId).map((member) => (
                            <li key={member.id}>
                              <button type="button" onClick={() => open(member.id)} className={`flex w-full justify-between gap-2 rounded px-1 py-1 text-start text-sm ${member.matched ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                                <span>{member.name} <span className="text-xs text-slate-500">· {member.relation}</span></span>
                                {member.chronicCount > 0 && <span className="text-xs font-bold text-teal-700">{member.chronicCount} مزمن</span>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{count(total)} أسرة{params.query ? " مطابقة" : ""}</span>
        <span className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={params.page <= 1 || loading} onClick={() => setParams({ page: params.page - 1 })} className="h-8 px-3 text-xs">السابق</Button>
          <span className="tabular-nums">{params.page} / {pages}</span>
          <Button type="button" variant="outline" disabled={params.page >= pages || loading} onClick={() => setParams({ page: params.page + 1 })} className="h-8 px-3 text-xs">التالي</Button>
        </span>
      </div>

      {params.ben && <BeneficiaryDrawer key={params.ben} companyId={companyId} beneficiaryId={params.ben} onClose={() => setParams({ ben: null })} onChanged={() => setVersion((value) => value + 1)} />}
    </Card>
  );
}

function PhoneBadge({ phone }: { phone: string | null }) {
  return phone
    ? <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300"><Phone className="h-3 w-3" /><span dir="ltr">{phone}</span></span>
    : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">بلا هاتف</span>;
}

function FamilyRows({ family, expanded, onToggle, onOpen }: { family: Family; expanded: boolean; onToggle: () => void; onOpen: (id: string) => void }) {
  const others = family.members.filter((member) => member.id !== family.headId);
  const head = family.members.find((member) => member.id === family.headId);
  return (
    <>
      <tr className="cursor-pointer border-t border-slate-100 hover:bg-teal-50/60 dark:border-slate-800 dark:hover:bg-teal-950/20" onClick={() => onOpen(family.headId)}>
        <td className="p-2" onClick={(event) => event.stopPropagation()}>
          {others.length > 0 && (
            <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? "إخفاء أفراد الأسرة" : "إظهار أفراد الأسرة"} className="rounded p-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <ChevronLeft className={`h-4 w-4 transition ${expanded ? "-rotate-90" : ""}`} />
            </button>
          )}
        </td>
        <td className={`p-2 font-bold text-slate-900 dark:text-white ${head?.matched ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
          {family.name}
          {!family.hasHeadCard && <span className="ms-1 text-xs font-normal text-slate-500">(لا توجد بطاقة أساسية)</span>}
          {family.status === "SUSPENDED" && <span className="ms-1 text-xs font-bold text-rose-600">موقوف</span>}
        </td>
        <td className="p-2 font-mono text-xs text-slate-600" dir="ltr">{family.cardNumber}</td>
        <td className="p-2 text-center tabular-nums">{family.members.length}</td>
        <td className="p-2 text-xs"><PhoneBadge phone={family.phone} /></td>
        <td className="p-2 text-center">{family.hasPassword ? <ShieldCheck className="mx-auto h-4 w-4 text-emerald-600" aria-label="مسجّلة" /> : <span className="text-slate-300">—</span>}</td>
        <td className="p-2 text-center tabular-nums">{family.chronicCount > 0 ? <span className="font-bold text-teal-700">{family.chronicCount}</span> : <span className="text-slate-300">—</span>}</td>
        <td className="p-2 text-xs tabular-nums text-slate-500">{family.lastDispenseAt ? day(family.lastDispenseAt) : "—"}</td>
      </tr>
      {expanded && others.map((member) => (
        <tr key={member.id} className={`cursor-pointer text-xs hover:bg-teal-50/60 dark:hover:bg-teal-950/20 ${member.matched ? "bg-amber-50 dark:bg-amber-950/30" : "bg-slate-50/60 dark:bg-slate-900/40"}`} onClick={() => onOpen(member.id)}>
          <td />
          <td className="p-1.5 ps-6">{member.name} <span className="text-slate-500">· {member.relation}</span>{member.status === "SUSPENDED" && <span className="ms-1 font-bold text-rose-600">موقوف</span>}</td>
          <td className="p-1.5 font-mono text-slate-500" dir="ltr">{member.cardNumber}</td>
          <td colSpan={3} />
          <td className="p-1.5 text-center tabular-nums">{member.chronicCount > 0 ? <span className="font-bold text-teal-700">{member.chronicCount}</span> : ""}</td>
          <td className="p-1.5 tabular-nums text-slate-500">{member.lastDispenseAt ? day(member.lastDispenseAt) : ""}</td>
        </tr>
      ))}
    </>
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
