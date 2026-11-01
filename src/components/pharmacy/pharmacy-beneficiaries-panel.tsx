"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ChevronLeft, Download, FileSpreadsheet, KeyRound, Loader2, LockKeyhole, Pause, Pencil, Phone, Pill, Play, Plus, Printer, Search, ShieldCheck, Upload, Users, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { FamilyFilter } from "@/lib/pharmacy/families";
import { Badge, Button, Card, Input, TableSkeleton } from "@/components/ui";
import {
  addChronicDrug,
  getPharmacyBeneficiaryDetails,
  listPharmacyFamilies,
  resetFamilyPassword,
  searchDrugCatalog,
  setBeneficiaryPhone,
  updateChronicDrug,
} from "@/app/actions/pharmacy-beneficiaries";
import { importFamilyPhones, type PhoneImportStatus } from "@/app/actions/pharmacy-phone-import";
import { formatDateTripoli } from "@/lib/datetime";

type FamilyResult = Awaited<ReturnType<typeof listPharmacyFamilies>>;
type Family = FamilyResult["families"][number];
type Details = Extract<Awaited<ReturnType<typeof getPharmacyBeneficiaryDetails>>, { beneficiary: unknown }>;

const CATEGORY: Record<string, string> = { ROUTINE: "روتيني", CHRONIC: "مزمن", CHEMICAL: "أورام" };
const day = (value: string) => formatDateTripoli(value);
const money = (value: number) => `${value.toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} د.ل`;
const count = (value: number) => value.toLocaleString("en");

/** بطاقات الإحصاء بنفس ألوان بطاقات ملخص الخدمات الأخرى (حد ملوّن، عنوان صغير، رقم كبير). */
const FILTERS: Array<{ id: FamilyFilter; label: string; card: string; title: string; value: string }> = [
  { id: "all", label: "كل الأسر", card: "border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/10", title: "text-teal-600 dark:text-teal-500", value: "text-teal-800 dark:text-teal-300" },
  { id: "with_phone", label: "لديها هاتف", card: "border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-900/10", title: "text-sky-600 dark:text-sky-500", value: "text-sky-800 dark:text-sky-300" },
  { id: "no_phone", label: "بلا هاتف", card: "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10", title: "text-amber-600 dark:text-amber-500", value: "text-amber-800 dark:text-amber-300" },
  { id: "no_portal", label: "غير مسجّلة في البوابة", card: "", title: "text-slate-400", value: "text-slate-900 dark:text-white" },
  { id: "chronic", label: "لديها مزمن", card: "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10", title: "text-blue-600 dark:text-blue-500", value: "text-blue-800 dark:text-blue-300" },
  { id: "recent", label: "صُرف لها خلال 30 يومًا", card: "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10", title: "text-emerald-600 dark:text-emerald-500", value: "text-emerald-800 dark:text-emerald-300" },
  { id: "never", label: "لم يُصرف لها", card: "", title: "text-slate-400", value: "text-slate-900 dark:text-white" },
];
const SELECT = "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
const TH = "px-4 py-3 font-black text-slate-500 dark:text-slate-400";
const PAGE_BUTTON = "inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300 dark:disabled:border-slate-800 dark:disabled:bg-slate-900/50 dark:disabled:text-slate-600";

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
    phone: search.get("phone") ?? "",
    chronic: search.get("chronic") ?? "",
    page: Math.max(1, Number(search.get("page")) || 1),
    ben: search.get("ben"),
  };
  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    const params = new URLSearchParams(window.location.search);
    const set = (key: string, value: string | null, empty: string) => (value && value !== empty ? params.set(key, value) : params.delete(key));
    set("q", next.query, "");
    set("filter", next.filter, "all");
    set("phone", next.phone, "");
    set("chronic", next.chronic, "");
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
export function PharmacyBeneficiariesPanel({ companyId, canEdit = false, canExport = false }: { companyId: string; canEdit?: boolean; canExport?: boolean }) {
  const [params, setParams] = useListParams();
  const [draft, setDraft] = useState(params.query);
  const [result, setResult] = useState<FamilyResult | null>(null);
  const [stats, setStats] = useState<FamilyResult["stats"]>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);
  const [importing, setImporting] = useState(false);
  const requestKey = JSON.stringify([params.query, params.filter, params.phone, params.chronic, params.page, version]);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    listPharmacyFamilies(companyId, { query: params.query, filter: params.filter, page: params.page, phone: params.phone, chronic: params.chronic }).then((next) => {
      if (cancelled) return;
      setResult(next);
      if (next.stats) setStats(next.stats);
      setLoadedKey(requestKey);
      // عند البحث تُفتح الأسر التي طابقها فرد غير صاحب البطاقة حتى يظهر المطابق مباشرة.
      setExpanded(new Set(next.families.filter((family) => family.members.some((member) => member.matched && member.id !== family.headId)).map((family) => family.key)));
    });
    return () => { cancelled = true; };
  }, [companyId, params.query, params.filter, params.phone, params.chronic, params.page, requestKey]);

  const families = result?.families ?? [];
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (result?.pageSize ?? 50)));
  const toggle = (key: string) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const open = (id: string) => setParams({ ben: id });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" aria-pressed={params.filter === item.id} onClick={() => setParams({ filter: item.id, page: 1 })} className="text-start">
            <Card className={`h-full p-4 transition-shadow hover:shadow-md ${item.card} ${params.filter === item.id ? "ring-2 ring-teal-500 dark:ring-teal-400" : ""}`}>
              <p className={`text-[10px] font-black uppercase tracking-wider ${item.title}`}>{item.label}</p>
              <p className={`mt-1 text-2xl font-black tabular-nums ${item.value}`}>{stats ? count(stats[item.id] ?? 0) : "…"}</p>
            </Card>
          </button>
        ))}
      </div>

      <Card className="space-y-4 overflow-hidden rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="flex items-center gap-2 whitespace-nowrap text-base font-black text-slate-900 dark:text-white">
              <Users className="h-5 w-5 text-teal-600" /> أسر مستفيدي هذه الشركة
            </h2>
            <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-400 dark:border-slate-700 dark:bg-slate-800">
              صفحة {params.page} من {pages}
            </span>
            {stats && <span className="hidden text-xs font-bold text-slate-400 sm:inline">{count(stats.beneficiaries)} مستفيد في {count(stats.all)} أسرة</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canExport && (
              <a
                href={`/api/pharmacy/beneficiaries-export?${new URLSearchParams({ company: companyId, filter: params.filter, q: params.query, phone: params.phone, chronic: params.chronic }).toString()}`}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-emerald-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-emerald-400 dark:hover:bg-slate-700"
              >
                <Download className="h-4 w-4 text-emerald-600" /> <span>تصدير Excel</span>
              </a>
            )}
            {canEdit && (
              <Button type="button" onClick={() => setImporting(true)} className="h-9 gap-1.5 px-4 text-xs font-black">
                <Upload className="h-4 w-4" /> استيراد الهواتف
              </Button>
            )}
          </div>
        </div>

        <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setParams({ query: draft.trim(), page: 1 }); }}>
          <div className="relative min-w-60 flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="الاسم بأي ترتيب، رقم البطاقة، الرقم الوظيفي أو الهاتف" className="pr-9" aria-label="بحث في المستفيدين" />
          </div>
          <select value={params.phone} onChange={(event) => setParams({ phone: event.target.value, page: 1 })} aria-label="الهاتف" className={SELECT}>
            <option value="">الهاتف: الكل</option>
            <option value="with">لديها هاتف</option>
            <option value="without">بلا هاتف</option>
          </select>
          <select value={params.chronic} onChange={(event) => setParams({ chronic: event.target.value, page: 1 })} aria-label="الأدوية المزمنة" className={SELECT}>
            <option value="">المزمن: الكل</option>
            <option value="yes">لديها مزمن</option>
            <option value="no">بدون مزمن</option>
          </select>
          <Button type="submit" className="bg-teal-600 px-6 text-white hover:bg-teal-700">بحث</Button>
          {(params.query || params.phone || params.chronic || params.filter !== "all") && <Button type="button" variant="outline" onClick={() => { setDraft(""); setParams({ query: "", phone: "", chronic: "", filter: "all", page: 1 }); }}>إعادة تعيين</Button>}
        </form>
        {result?.error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{result.error}</p>}

        <div className={loading ? "opacity-60" : ""}>
          {loading && !result ? (
            <TableSkeleton rows={8} cols={7} />
          ) : families.length === 0 ? (
            <p className="py-10 text-center text-sm italic text-slate-500 dark:text-slate-400">لا توجد نتائج مطابقة.</p>
          ) : (
            <>
              {/* سطح المكتب: جدول */}
              <div className="-mx-5 hidden overflow-x-auto sm:block">
                <table className="w-full border-collapse text-right text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50">
                    <tr>
                      <th className="w-10 px-4 py-3" />
                      <th className={TH}>صاحب البطاقة</th>
                      <th className={TH}>رقم البطاقة</th>
                      <th className={`${TH} text-center`}>الأفراد</th>
                      <th className={TH}>الهاتف</th>
                      <th className={`${TH} text-center`}>البوابة</th>
                      <th className={`${TH} text-center`}>مزمن</th>
                      <th className={TH}>آخر صرف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {families.map((family) => (
                      <FamilyRows key={family.key} family={family} expanded={expanded.has(family.key)} onToggle={() => toggle(family.key)} onOpen={open} />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* الجوال: بطاقات */}
              <div className="-mx-5 divide-y divide-slate-100 dark:divide-slate-800 sm:hidden">
                {families.map((family) => (
                  <div key={family.key} className="px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <button type="button" onClick={() => open(family.headId)} className="block w-full text-start">
                      <p className="font-black text-slate-900 dark:text-white">{family.name}</p>
                      <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">بطاقة: {family.cardNumber}</p>
                    </button>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <PhoneBadge phone={family.phone} />
                      {family.hasPassword && <Badge variant="success"><ShieldCheck className="me-1 h-3 w-3" /> البوابة</Badge>}
                      {family.chronicCount > 0 && <Badge variant="info"><Pill className="me-1 h-3 w-3" /> {family.chronicCount} مزمن</Badge>}
                    </div>
                    {family.members.length > 1 && (
                      <>
                        <button type="button" onClick={() => toggle(family.key)} className="mt-2 text-xs font-bold text-teal-700 dark:text-teal-400">
                          {expanded.has(family.key) ? "إخفاء الأفراد" : `+${family.members.length - 1} من الأسرة`}
                        </button>
                        {expanded.has(family.key) && (
                          <div className="mt-1 space-y-0.5 border-t border-slate-100 pt-1 dark:border-slate-800">
                            {family.members.filter((member) => member.id !== family.headId).map((member) => (
                              <button key={member.id} type="button" onClick={() => open(member.id)} className={`flex w-full justify-between gap-2 rounded px-1 py-1 text-start text-sm ${member.matched ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                                <span>{member.name} <span className="text-xs text-slate-500">· {member.relation}</span></span>
                                {member.chronicCount > 0 && <span className="text-xs font-bold text-blue-700 dark:text-blue-400">{member.chronicCount} مزمن</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
          <span className="text-xs font-bold text-slate-500">{count(total)} أسرة{params.query ? " مطابقة" : ""}</span>
          <span className="flex items-center gap-1">
            <button type="button" disabled={params.page <= 1 || loading} onClick={() => setParams({ page: params.page - 1 })} className={PAGE_BUTTON}>السابق</button>
            <span className="px-2 text-sm text-slate-400 tabular-nums">{params.page} / {pages}</span>
            <button type="button" disabled={params.page >= pages || loading} onClick={() => setParams({ page: params.page + 1 })} className={PAGE_BUTTON}>التالي</button>
          </span>
        </div>
      </Card>

      {importing && <PhoneImportDialog companyId={companyId} onClose={() => setImporting(false)} onApplied={() => setVersion((value) => value + 1)} />}
      {params.ben && <BeneficiaryDrawer key={params.ben} companyId={companyId} beneficiaryId={params.ben} onClose={() => setParams({ ben: null })} onChanged={() => setVersion((value) => value + 1)} />}
    </div>
  );
}

const IMPORT_STATUS: Record<PhoneImportStatus, { label: string; tone: string }> = {
  update: { label: "سيُحدَّث", tone: "bg-emerald-100 text-emerald-800" },
  same: { label: "بدون تغيير", tone: "bg-slate-100 text-slate-600" },
  invalid_phone: { label: "هاتف غير صحيح", tone: "bg-rose-100 text-rose-800" },
  not_found: { label: "بطاقة غير موجودة", tone: "bg-rose-100 text-rose-800" },
  phone_taken: { label: "الهاتف لبطاقة أخرى", tone: "bg-amber-100 text-amber-800" },
  duplicate_phone: { label: "هاتف مكرر في الملف", tone: "bg-amber-100 text-amber-800" },
  conflict: { label: "أسرة بهاتفين", tone: "bg-amber-100 text-amber-800" },
};
type ImportResult = Extract<Awaited<ReturnType<typeof importFamilyPhones>>, { rows: unknown }>;

/** استيراد الهواتف: اختيار الملف ← معاينة بالأعداد والمشاكل ← تطبيق التحديثات الصحيحة فقط. */
function PhoneImportDialog({ companyId, onClose, onApplied }: { companyId: string; onClose: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();

  const pick = async (picked: File | undefined) => {
    setPreview(null); setDone(null); setError("");
    if (!picked) return;
    const bytes = new Uint8Array(await picked.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    const next = { name: picked.name, base64: btoa(binary) };
    setFile(next);
    startBusy(async () => {
      const result = await importFamilyPhones(companyId, next.base64, false);
      if ("error" in result && result.error) setError(result.error); else setPreview(result as ImportResult);
    });
  };
  const applyNow = () => file && startBusy(async () => {
    const result = await importFamilyPhones(companyId, file.base64, true);
    if ("error" in result && result.error) { setError(result.error); return; }
    setPreview(result as ImportResult);
    setDone((result as ImportResult).applied);
    onApplied();
  });
  const updates = preview?.counts.update ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3" role="dialog" aria-modal="true" aria-label="استيراد الهواتف">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="flex items-center gap-2 text-lg font-black"><FileSpreadsheet className="h-5 w-5 text-teal-600" /> استيراد هواتف الأسر</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4 text-sm">
          <p className="text-slate-600 dark:text-slate-300">
            ملف Excel صفه الأول فيه عمودا <b>«رقم البطاقة»</b> و<b>«الهاتف»</b>. أسهل طريقة: صدّر «بلا هاتف» ثم عبّئ عمود الهاتف وارفع الملف نفسه.
            بطاقة أي فرد تكفي، فالهاتف يُحفظ لصاحب البطاقة في أسرته. لن يتغير شيء قبل الضغط على «تطبيق».
          </p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 font-bold text-slate-600 hover:border-teal-400 dark:border-slate-600">
            <Upload className="h-5 w-5" /> {file ? file.name : "اختر ملف Excel"}
            <input type="file" accept=".xlsx" className="sr-only" aria-label="ملف الهواتف" onChange={(event) => void pick(event.target.files?.[0])} />
          </label>
          {busy && <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ الفحص…</p>}
          {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 font-bold text-rose-700">{error}</p>}
          {done !== null && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 font-bold text-emerald-800">تم تحديث {count(done)} هاتف.</p>}
          {preview && (
            <>
              <p className="text-slate-500">{count(preview.total)} صف في الملف:</p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(IMPORT_STATUS) as PhoneImportStatus[]).filter((key) => preview.counts[key]).map((key) => (
                  <span key={key} className={`rounded-full px-2.5 py-1 text-xs font-bold ${IMPORT_STATUS[key].tone}`}>{IMPORT_STATUS[key].label}: {count(preview.counts[key] ?? 0)}</span>
                ))}
              </div>
              {preview.rows.length > 0 && (
                <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-800">
                      <tr><th className="p-1.5 text-start">صف</th><th className="p-1.5 text-start">البطاقة</th><th className="p-1.5 text-start">صاحب البطاقة</th><th className="p-1.5 text-start">قبل</th><th className="p-1.5 text-start">بعد</th><th className="p-1.5 text-start">الحالة</th></tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.row} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="p-1.5 tabular-nums">{row.row}</td>
                          <td className="p-1.5 font-mono" dir="ltr">{row.card}</td>
                          <td className="p-1.5">{row.holderName ?? "—"}</td>
                          <td className="p-1.5 font-mono" dir="ltr">{row.before ?? "—"}</td>
                          <td className="p-1.5 font-mono" dir="ltr">{row.phone}</td>
                          <td className="p-1.5"><span className={`rounded-full px-2 py-0.5 font-bold ${IMPORT_STATUS[row.status].tone}`}>{IMPORT_STATUS[row.status].label}</span>{row.note && <span className="ms-1 text-slate-500">{row.note}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <Button type="button" variant="outline" onClick={onClose}>إغلاق</Button>
          <Button type="button" disabled={busy || !preview || updates === 0 || done !== null} onClick={applyNow} className="bg-teal-600 text-white hover:bg-teal-700">
            تطبيق {count(updates)} تحديث
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhoneBadge({ phone }: { phone: string | null }) {
  return phone
    ? <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 dark:text-slate-300"><Phone className="h-3 w-3 text-slate-400" /><span dir="ltr">{phone}</span></span>
    : <Badge variant="warning">بلا هاتف</Badge>;
}

function FamilyRows({ family, expanded, onToggle, onOpen }: { family: Family; expanded: boolean; onToggle: () => void; onOpen: (id: string) => void }) {
  const others = family.members.filter((member) => member.id !== family.headId);
  const head = family.members.find((member) => member.id === family.headId);
  return (
    <>
      <tr className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${head?.matched ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`} onClick={() => onOpen(family.headId)}>
        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
          {others.length > 0 && (
            <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? "إخفاء أفراد الأسرة" : "إظهار أفراد الأسرة"} className="rounded-md border border-slate-200 p-0.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
              <ChevronLeft className={`h-4 w-4 transition ${expanded ? "-rotate-90" : ""}`} />
            </button>
          )}
        </td>
        <td className="px-4 py-3">
          <span className="font-black text-slate-900 dark:text-white">{family.name}</span>
          {family.status === "SUSPENDED" && <Badge variant="warning" className="ms-2">موقوف</Badge>}
          {!family.hasHeadCard && <p className="text-[11px] text-slate-400">لا توجد بطاقة أساسية للأسرة</p>}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{family.cardNumber}</td>
        <td className="px-4 py-3 text-center font-bold tabular-nums text-slate-700 dark:text-slate-300">{family.members.length}</td>
        <td className="px-4 py-3"><PhoneBadge phone={family.phone} /></td>
        <td className="px-4 py-3 text-center">{family.hasPassword ? <Badge variant="success">مسجّلة</Badge> : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
        <td className="px-4 py-3 text-center">{family.chronicCount > 0 ? <Badge variant="info">{family.chronicCount}</Badge> : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
        <td className="px-4 py-3 text-xs tabular-nums text-slate-500 dark:text-slate-400">{family.lastDispenseAt ? day(family.lastDispenseAt) : "—"}</td>
      </tr>
      {expanded && others.map((member) => (
        <tr key={member.id} className={`cursor-pointer text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/60 ${member.matched ? "bg-amber-50/60 dark:bg-amber-950/20" : "bg-slate-50/70 dark:bg-slate-800/30"}`} onClick={() => onOpen(member.id)}>
          <td />
          <td className="px-4 py-2 ps-8">
            <span className="font-bold text-slate-700 dark:text-slate-200">{member.name}</span> <span className="text-slate-400">· {member.relation}</span>
            {member.status === "SUSPENDED" && <Badge variant="warning" className="ms-2">موقوف</Badge>}
          </td>
          <td className="px-4 py-2 font-mono text-slate-500 dark:text-slate-400">{member.cardNumber}</td>
          <td colSpan={3} />
          <td className="px-4 py-2 text-center">{member.chronicCount > 0 ? <Badge variant="info">{member.chronicCount}</Badge> : ""}</td>
          <td className="px-4 py-2 tabular-nums text-slate-500 dark:text-slate-400">{member.lastDispenseAt ? day(member.lastDispenseAt) : ""}</td>
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
