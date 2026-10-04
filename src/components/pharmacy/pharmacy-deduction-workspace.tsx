"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, FileText, History, Loader2, LockKeyhole, Phone, Plus, Search, Trash2, Upload, UserRound, X } from "lucide-react";
import {
  createPharmacyPrescription,
  dispenseChronicDrugs,
  dispensePharmacyPrescriptionItems,
  getPharmacyBeneficiaryWorkspace,
  searchPharmacyBeneficiaries,
  uploadPharmacyPrescriptionAttachment,
} from "@/app/actions/pharmacy";
import { Button, Card, Input } from "@/components/ui";
import { ACCEPTED_FILES, prepareFile } from "@/lib/pharmacy/client-files";

type CategoryValue = "ROUTINE" | "CHRONIC" | "CHEMICAL";
type AttachmentKind = "INSURANCE_CARD" | "PRESCRIPTION";

const CATEGORY_LABELS: Record<CategoryValue, string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدوية مزمنة", CHEMICAL: "أدوية كيميائية" };
const ATTACHMENT_LABELS: Record<AttachmentKind, string> = { INSURANCE_CARD: "صورة البطاقة التأمينية", PRESCRIPTION: "صورة الوصفة" };

type SearchItem = { id: string; card_number: string; name: string; phone_number: string | null; status: string };

type Usage = {
  category: CategoryValue;
  enabled: boolean;
  coveragePercent: number;
  categoryCeiling: number | null;
  overallCeiling: number | null;
  remaining: number | null;
  dailyLimit: number | null;
  todayCount: number | null;
};

type Slot = {
  id: string;
  sequence: number;
  status: "AVAILABLE" | "RESERVED" | "DISPENSED";
  reservation_expires_at: string | null;
  reserved_by_facility: { id: string; name: string } | null;
  dispensed_by_facility: { id: string; name: string } | null;
  reserved_by_current_facility: boolean;
  price: number | null;
};

type Prescription = {
  id: string;
  prescription_number: number;
  medicine_category: CategoryValue;
  total_item_count: number;
  created_at: string;
  created_by_facility: { id: string; name: string };
  attachments: Array<{ id: string; kind: AttachmentKind | null; file_name: string }>;
  slots: Slot[];
};

type ChronicDrug = {
  id: string;
  drug_name: string;
  notes: string | null;
  last_dispensed_at: string | null;
  last_facility_name: string | null;
  last_price: number | null;
  eligible: boolean;
  next_eligible_at: string | null;
};

type WorkspaceBeneficiary = SearchItem & {
  birth_date: string | null;
  company: { id: string; name: string } | null;
  pharmacy_dispenses: Array<{
    id: string;
    medicine_category: CategoryValue;
    gross_total: number;
    status: string;
    created_at: string;
    facility: { name: string };
    prescription: { prescription_number: number; total_item_count: number } | null;
    owned_by_current_facility: boolean;
    attachments: Array<{ id: string; kind: AttachmentKind | null }>;
    items: Array<{ sequence: number; price: number; drug_name: string | null }>;
  }>;
  pharmacy_prescriptions: Prescription[];
  chronic_drugs: ChronicDrug[];
};

type Workspace = { beneficiary: WorkspaceBeneficiary; usage: { categories: Usage[] } | null; chronicIntervalDays: number };

type ReviewLine = { label: string; price: number };
type PendingDispense = { lines: ReviewLine[]; files: string[]; submit: () => Promise<{ error?: string } | undefined> };

const money = (value: number) => `${value.toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} د.ل`;
const tripoliDate = (value: string) => new Date(value).toLocaleDateString("ar-LY", { timeZone: "Africa/Tripoli" });
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** تقدير الحصص في الواجهة بنفس قاعدة الخادم: السقف يُستهلك بالإجمالي، والصرف فوق المتبقي مرفوض. الخادم هو المرجع النهائي. */
function estimate(prices: number[], usage: Usage | undefined) {
  const coverage = (usage?.coveragePercent ?? 0) / 100;
  let available = usage?.remaining ?? null;
  let company = 0;
  let gross = 0;
  for (const price of prices) {
    if (!(price > 0)) continue;
    gross += price;
    const covered = available === null ? price : Math.min(price, available);
    if (available !== null) available -= covered;
    company += Math.round(covered * coverage * 100) / 100;
  }
  return { gross, company, patient: gross - company, remainingAfter: available };
}


export function PharmacyDeductionWorkspace({
  company,
  enabledCategories,
  currentFacility,
  fromOrder,
}: {
  company: { id: string; name: string; code: string; logo: string | null };
  enabledCategories: CategoryValue[];
  currentFacility: { id: string; name: string };
  /** عند الفتح من طلب مستفيد: المستفيد والفئة والأدوية المزمنة المطلوبة محددة مسبقًا. */
  fromOrder?: { orderId: string; beneficiaryId: string; beneficiaryLabel: string; category: CategoryValue; chronicDrugIds: string[] } | null;
}) {
  const [query, setQuery] = useState(fromOrder?.beneficiaryLabel ?? "");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [category, setCategory] = useState<CategoryValue>(fromOrder && enabledCategories.includes(fromOrder.category) ? fromOrder.category : enabledCategories[0] ?? "ROUTINE");
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<PendingDispense | null>(null);
  const [searching, startSearch] = useTransition();
  const [loadingBeneficiary, startBeneficiaryLoad] = useTransition();

  const beneficiary = workspace?.beneficiary ?? null;

  const runSearch = (searchQuery = query) => {
    setSearchError("");
    setHasSearched(true);
    startSearch(async () => {
      const response = await searchPharmacyBeneficiaries(company.id, searchQuery);
      setResults(response.items ?? []);
      if (response.error) setSearchError(response.error);
    });
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (beneficiary || loadingBeneficiary || trimmed.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    const timer = window.setTimeout(() => runSearch(trimmed), 250);
    return () => window.clearTimeout(timer);
    // runSearch deliberately uses the current company id and query snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, beneficiary, loadingBeneficiary, company.id]);

  const loadWorkspace = async (beneficiaryId: string) => {
    const response = await getPharmacyBeneficiaryWorkspace(company.id, beneficiaryId);
    if ("error" in response && response.error) { setSearchError(response.error); return false; }
    if (!("beneficiary" in response) || !response.beneficiary) { setSearchError("تعذر تحميل بيانات المستفيد"); return false; }
    setWorkspace({ beneficiary: response.beneficiary as unknown as WorkspaceBeneficiary, usage: response.usage ?? null, chronicIntervalDays: response.chronicIntervalDays ?? 28 });
    return true;
  };

  const selectBeneficiary = (item: SearchItem) => {
    setSearchError("");
    setNotice(null);
    setResults([]);
    setQuery(`${item.name} - ${item.card_number}`);
    startBeneficiaryLoad(async () => { await loadWorkspace(item.id); });
  };

  const reload = async () => { if (beneficiary) await loadWorkspace(beneficiary.id); };

  // الفتح من طلب مستفيد: تحميل ملفه مباشرة دون بحث.
  useEffect(() => {
    if (!fromOrder) return;
    startBeneficiaryLoad(async () => { await loadWorkspace(fromOrder.beneficiaryId); });
    // يُنفذ مرة واحدة عند الفتح.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usageFor = (value: CategoryValue) => workspace?.usage?.categories.find((item) => item.category === value);
  const chronicLinked = (beneficiary?.chronic_drugs.length ?? 0) > 0;
  const tabDisabledReason = (value: CategoryValue) => {
    if (!enabledCategories.includes(value)) return "غير مفعل في سياسة الشركة";
    if (value === "CHRONIC" && beneficiary && !chronicLinked) return "لا توجد أدوية مزمنة مرتبطة بالمستفيد";
    return null;
  };

  return (
    <div className="space-y-3" dir="rtl">
      <Card className="p-2">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); runSearch(); }}>
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input aria-label="بحث عن مستفيد" value={query} onChange={(event) => { setQuery(event.target.value); setWorkspace(null); setNotice(null); }} className="h-10 pr-9" placeholder="ابحث برقم البطاقة أو الاسم أو رقم الهاتف" />
          </div>
          <Button type="submit" disabled={searching || query.trim().length < 2} className="min-w-24">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} بحث
          </Button>
        </form>
        {searchError && <p role="alert" className="mt-2 text-sm font-bold text-red-600">{searchError}</p>}
        {!beneficiary && query.trim().length >= 2 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            {searching ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جاري البحث عن المستفيدين...</div>
            ) : results.length > 0 ? results.map((item) => (
              <button key={item.id} type="button" onClick={() => selectBeneficiary(item)} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-right last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                <span><strong className="block text-sm">{item.name}</strong><span className="text-sm text-slate-500" dir="ltr">{item.card_number}</span></span>
                <span className="text-sm text-slate-500" dir="ltr">{item.phone_number || "دون هاتف"}</span>
              </button>
            )) : hasSearched && !searchError ? (
              <p className="px-3 py-3 text-sm font-bold text-slate-500">لا توجد أسماء مطابقة داخل شركة {company.name}.</p>
            ) : null}
          </div>
        )}
      </Card>

      {loadingBeneficiary && <Card className="flex items-center justify-center gap-2 p-10 text-sm font-bold text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل ملف المستفيد</Card>}

      {beneficiary && workspace && !loadingBeneficiary && (
        <>
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
            <div className="flex items-center gap-2">
              <UserRound className="h-6 w-6 text-teal-600" aria-hidden />
              <h2 className="text-lg font-black text-slate-900 dark:text-white">{beneficiary.name}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-black ${beneficiary.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{beneficiary.status === "ACTIVE" ? "نشط" : "غير نشط"}</span>
            </div>
            <span className="text-sm text-slate-600 dark:text-slate-300">البطاقة: <strong dir="ltr">{beneficiary.card_number}</strong></span>
            <span className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300"><Phone className="h-3.5 w-3.5" aria-hidden /> <span dir="ltr">{beneficiary.phone_number || "غير مسجل"}</span></span>
            <span className="text-sm text-slate-600 dark:text-slate-300">المرفق المنفذ: <strong>{currentFacility.name}</strong></span>
          </Card>

          {notice && (
            <div role={notice.type === "error" ? "alert" : "status"} className={`flex items-start gap-2 rounded-md border p-3 text-sm font-bold ${notice.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300" : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
              {notice.type === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="flex-1">{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="إغلاق"><X className="h-4 w-4" /></button>
            </div>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <HistoryPanel beneficiary={beneficiary} />

            {/* على الجوال تأتي نافذة الصرف أولاً، وعلى الشاشات الواسعة يبقى السجل يمينًا */}
            <Card className="order-first p-3 sm:p-4 lg:order-none">
              <div role="tablist" aria-label="نوع الأدوية" className="mb-3 grid grid-cols-3 gap-2">
                {(["ROUTINE", "CHRONIC", "CHEMICAL"] as const).map((value) => {
                  const reason = tabDisabledReason(value);
                  const usage = usageFor(value);
                  const active = category === value && !reason;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-disabled={Boolean(reason)}
                      title={reason ?? undefined}
                      onClick={() => { if (!reason) { setCategory(value); setNotice(null); } }}
                      className={`rounded-lg border p-2 text-start transition ${active ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500 dark:bg-teal-950/30" : reason ? "cursor-not-allowed border-slate-200 opacity-50 dark:border-slate-700" : "border-slate-200 hover:border-teal-300 dark:border-slate-700"}`}
                    >
                      <span className="block text-sm font-black">{CATEGORY_LABELS[value]}</span>
                      <span className="mt-0.5 block text-xs font-bold text-slate-500">
                        {reason ?? (value === "CHRONIC" ? `${beneficiary.chronic_drugs.filter((drug) => drug.eligible).length} من ${beneficiary.chronic_drugs.length} متاح` : `اليوم ${usage?.todayCount ?? 0} من ${usage?.dailyLimit ?? 2}`)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {tabDisabledReason(category) ? (
                <EmptyState text={tabDisabledReason(category)!} />
              ) : (
                <>
                  <PolicyStrip usage={usageFor(category)} />
                  {category === "CHRONIC" ? (
                    <ChronicTab
                      key={`chronic-${beneficiary.id}`}
                      drugs={beneficiary.chronic_drugs}
                      orderCard={fromOrder?.beneficiaryId === beneficiary.id ? { orderId: fromOrder.orderId, preselect: fromOrder.chronicDrugIds } : null}
                      usage={usageFor("CHRONIC")}
                      intervalDays={workspace.chronicIntervalDays}
                      onReview={setPending}
                      submit={async (items, files, idempotencyKey) => {
                        const formData = new FormData();
                        formData.set("companyId", company.id);
                        formData.set("beneficiaryId", beneficiary.id);
                        formData.set("idempotencyKey", idempotencyKey);
                        formData.set("items", JSON.stringify(items));
                        if (files.INSURANCE_CARD) formData.set("insuranceCard", files.INSURANCE_CARD);
                        else if (fromOrder?.beneficiaryId === beneficiary.id) formData.set("orderId", fromOrder.orderId);
                        const response = await dispenseChronicDrugs(formData);
                        if ("error" in response && response.error) return { error: response.error };
                        setNotice({ type: "success", text: "grossTotal" in response ? `تم صرف الأدوية المزمنة: الإجمالي ${money(response.grossTotal)}، حصة الشركة ${money(response.companyTotal)}، على المستفيد ${money(response.patientTotal)}` : "تم الصرف" });
                        await reload();
                        return undefined;
                      }}
                    />
                  ) : (
                    <PrescriptionTab
                      key={`${category}-${beneficiary.id}`}
                      prescriptions={beneficiary.pharmacy_prescriptions.filter((item) => item.medicine_category === category)}
                      usage={usageFor(category)}
                      onError={(text) => setNotice({ type: "error", text })}
                      onReview={setPending}
                      reload={reload}
                      createPrescription={async () => {
                        const response = await createPharmacyPrescription({ companyId: company.id, beneficiaryId: beneficiary.id, category });
                        if ("error" in response && response.error) return { error: response.error };
                        return { prescriptionId: "prescriptionId" in response ? response.prescriptionId : undefined };
                      }}
                      submit={async (prescriptionId, items, idempotencyKey) => {
                        const response = await dispensePharmacyPrescriptionItems({ prescriptionId, items, idempotencyKey });
                        if ("error" in response && response.error) return { error: response.error };
                        setNotice({ type: "success", text: "grossTotal" in response ? `تم الصرف: الإجمالي ${money(response.grossTotal)}، حصة الشركة ${money(response.companyTotal)}، على المستفيد ${money(response.patientTotal)}` : "تم الصرف" });
                        await reload();
                        return undefined;
                      }}
                    />
                  )}
                </>
              )}
            </Card>
          </div>
        </>
      )}

      {pending && workspace && (
        <ReviewDialog
          pending={pending}
          usage={usageFor(category)}
          categoryLabel={CATEGORY_LABELS[category]}
          onClose={() => setPending(null)}
          onDone={(error) => { setPending(null); if (error) setNotice({ type: "error", text: error }); }}
        />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-5 text-sm font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
      <LockKeyhole className="h-5 w-5 shrink-0" aria-hidden /> {text}
    </div>
  );
}

function PolicyStrip({ usage }: { usage: Usage | undefined }) {
  if (!usage) return null;
  const ceilingText = usage.remaining === null ? "سقف مفتوح" : `المتبقي من السقف ${money(usage.remaining)}`;
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
      <span>التغطية {usage.coveragePercent}%</span>
      <span>{ceilingText}</span>
      {usage.categoryCeiling !== null && <span className="text-teal-700/80 dark:text-teal-400/80">سقف الفئة {money(usage.categoryCeiling)}</span>}
      {usage.overallCeiling !== null && <span className="text-teal-700/80 dark:text-teal-400/80">السقف العام {money(usage.overallCeiling)}</span>}
    </div>
  );
}

function HistoryPanel({ beneficiary }: { beneficiary: WorkspaceBeneficiary }) {
  return (
    <Card className="p-3 sm:p-4">
      <h3 className="mb-3 flex items-center gap-2 text-base font-black"><History className="h-4 w-4 text-teal-600" aria-hidden /> سجل الصرف</h3>
      {beneficiary.pharmacy_dispenses.length === 0 ? <p className="text-sm text-slate-500">لم يُصرف للمستفيد شيء بعد.</p> : (
        <ol className="space-y-2">
          {beneficiary.pharmacy_dispenses.map((dispense) => (
            <li key={dispense.id} className={`rounded-md border p-2.5 ${dispense.status === "CANCELLED" ? "border-slate-200 opacity-60 dark:border-slate-700" : "border-slate-200 dark:border-slate-700"}`}>
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-sm font-black">{CATEGORY_LABELS[dispense.medicine_category]}{dispense.prescription ? ` · وصفة ${dispense.prescription.prescription_number}` : ""}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${dispense.owned_by_current_facility ? "bg-teal-100 text-teal-700" : "bg-amber-100 text-amber-800"}`}>{dispense.owned_by_current_facility ? "هذا المرفق" : "مرفق آخر"}</span>
              </div>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{dispense.facility.name} · {tripoliDate(dispense.created_at)}{dispense.status === "CANCELLED" ? " · ملغى" : ""}</p>
              <ul className="mt-1.5 space-y-0.5 text-sm">
                {dispense.items.map((item) => (
                  <li key={item.sequence} className="flex justify-between gap-2 text-slate-700 dark:text-slate-300">
                    <span className="truncate">{item.drug_name ?? `البند ${item.sequence}`}</span>
                    <span className="tabular-nums text-slate-500">{money(item.price)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1 dark:border-slate-800">
                <span className="text-sm font-black tabular-nums">الإجمالي {money(dispense.gross_total)}</span>
                <span className="flex gap-2">
                  {dispense.attachments.map((attachment) => (
                    <a key={attachment.id} href={`/api/pharmacy/attachments/${attachment.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline dark:text-teal-300">
                      {attachment.kind === "INSURANCE_CARD" ? <CreditCard className="h-3.5 w-3.5" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
                      {attachment.kind === "INSURANCE_CARD" ? "البطاقة" : "الوصفة"}
                    </a>
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function FileZone({ kind, fileName, href, busy, disabled, onPick, onClear }: { kind: AttachmentKind; fileName: string | null; href?: string; busy?: boolean; disabled?: boolean; onPick: (file: File) => void; onClear?: () => void }) {
  const Icon = kind === "INSURANCE_CARD" ? CreditCard : FileText;
  return (
    <div className={`flex min-h-16 items-center gap-2 rounded-lg border-2 border-dashed p-2.5 focus-within:ring-2 focus-within:ring-teal-500 ${fileName ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-slate-300 dark:border-slate-700"}`}>
      <Icon className={`h-6 w-6 shrink-0 ${fileName ? "text-emerald-600" : "text-slate-400"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black">{ATTACHMENT_LABELS[kind]} <span className="text-red-500" aria-hidden>*</span></p>
        {href && fileName
          ? <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate text-xs font-bold text-teal-700 hover:underline dark:text-teal-300">{fileName}</a>
          : <p className="truncate text-xs text-slate-500">{fileName ?? "PDF أو JPG أو PNG · حتى 8 ميجابايت"}</p>}
      </div>
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-teal-600" /> : (
        <>
          <label className={`rounded-md border border-teal-300 ${disabled ? "pointer-events-none opacity-40" : "cursor-pointer"} px-2.5 py-1.5 text-xs font-black text-teal-700 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300`}>
            {fileName ? "استبدال" : <span className="inline-flex items-center gap-1"><Upload className="h-3.5 w-3.5" /> رفع</span>}
            <input type="file" accept={ACCEPTED_FILES} disabled={disabled} className="sr-only" aria-label={ATTACHMENT_LABELS[kind]} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPick(file); }} />
          </label>
          {fileName && onClear && <button type="button" onClick={onClear} aria-label={`حذف ${ATTACHMENT_LABELS[kind]}`} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}
        </>
      )}
    </div>
  );
}

function Totals({ prices, usage }: { prices: number[]; usage: Usage | undefined }) {
  const totals = estimate(prices, usage);
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-900/50">
      <div><p className="text-xs font-bold text-slate-500">الإجمالي</p><p className="font-black tabular-nums">{money(totals.gross)}</p></div>
      <div><p className="text-xs font-bold text-slate-500">حصة الشركة</p><p className="font-black tabular-nums text-teal-700 dark:text-teal-400">{money(totals.company)}</p></div>
      <div><p className="text-xs font-bold text-slate-500">على المستفيد</p><p className="font-black tabular-nums text-amber-700 dark:text-amber-400">{money(totals.patient)}</p></div>
      {usage?.remaining !== null && usage?.remaining !== undefined && totals.gross > usage.remaining && (
        <p className="col-span-3 text-xs font-bold text-rose-700">الإجمالي يتجاوز المتبقي من السقف المخصص؛ لا يُسمح بالصرف فوق السقف.</p>
      )}
    </div>
  );
}

type LineDraft = { key: string; sequence: string; price: string };

const tripoliDayKey = (value: string | Date) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Africa/Tripoli" });

/**
 * تبويب الروتيني والكيميائي: تظهر مباشرة بطاقات وصفات اليوم بعدد الحد اليومي في السياسة.
 * البطاقة الفارغة تتحول إلى وصفة فعلية عند أول رفع لمرفقاتها.
 */
function PrescriptionTab({
  prescriptions,
  usage,
  onError,
  onReview,
  reload,
  createPrescription,
  submit,
}: {
  prescriptions: Prescription[];
  usage: Usage | undefined;
  onError: (text: string) => void;
  onReview: (pending: PendingDispense) => void;
  reload: () => Promise<void>;
  createPrescription: () => Promise<{ error?: string; prescriptionId?: string }>;
  submit: (prescriptionId: string, items: Array<{ sequence: number; price: number }>, idempotencyKey: string) => Promise<{ error?: string } | undefined>;
}) {
  const dailyLimit = usage?.dailyLimit ?? 2;
  const today = tripoliDayKey(new Date());
  const todays = prescriptions
    .filter((item) => tripoliDayKey(item.created_at) === today)
    .sort((a, b) => a.prescription_number - b.prescription_number);
  const emptySlots = Math.max(0, dailyLimit - Math.max(usage?.todayCount ?? 0, todays.length));

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">مسموح {dailyLimit} وصفات يوميًا، ويتجدد الحد عند منتصف الليل.</p>
      {todays.map((prescription, index) => (
        <PrescriptionCard key={prescription.id} title={`الوصفة ${index + 1}`} prescription={prescription} usage={usage} onError={onError} onReview={onReview} reload={reload} createPrescription={createPrescription} submit={submit} />
      ))}
      {Array.from({ length: emptySlots }, (_, index) => (
        <PrescriptionCard key={`empty-${todays.length + index}`} title={`الوصفة ${todays.length + index + 1}`} prescription={null} usage={usage} onError={onError} onReview={onReview} reload={reload} createPrescription={createPrescription} submit={submit} />
      ))}
      {todays.length === 0 && emptySlots === 0 && <EmptyState text="استنفد المستفيد وصفات اليوم" />}
    </div>
  );
}

function PrescriptionCard({
  title,
  prescription,
  usage,
  onError,
  onReview,
  reload,
  createPrescription,
  submit,
}: {
  title: string;
  prescription: Prescription | null;
  usage: Usage | undefined;
  onError: (text: string) => void;
  onReview: (pending: PendingDispense) => void;
  reload: () => Promise<void>;
  createPrescription: () => Promise<{ error?: string; prescriptionId?: string }>;
  submit: (prescriptionId: string, items: Array<{ sequence: number; price: number }>, idempotencyKey: string) => Promise<{ error?: string } | undefined>;
}) {
  const [lines, setLines] = useState<LineDraft[]>([{ key: newKey(), sequence: "", price: "" }]);
  const [uploading, setUploading] = useState<AttachmentKind | null>(null);
  const [busy, startBusy] = useTransition();

  const attachmentOf = (kind: AttachmentKind) => prescription?.attachments.find((item) => item.kind === kind) ?? null;
  const hasAttachments = Boolean(attachmentOf("INSURANCE_CARD") && attachmentOf("PRESCRIPTION"));
  const dispensedSlots = prescription?.slots.filter((slot) => slot.status === "DISPENSED") ?? [];

  const lineError = (line: LineDraft, index: number) => {
    if (line.sequence === "") return null;
    const sequence = Number(line.sequence);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 50) return "رقم البند بين 1 و50";
    if (lines.some((other, otherIndex) => otherIndex < index && Number(other.sequence) === sequence)) return "رقم مكرر";
    const slot = prescription?.slots.find((item) => item.sequence === sequence);
    if (slot?.status === "DISPENSED") return `صُرف لدى ${slot.dispensed_by_facility?.name ?? "مرفق آخر"}`;
    if (line.price !== "" && !(Number(line.price) > 0)) return "السعر يجب أن يكون أكبر من صفر";
    return null;
  };

  const filledLines = lines.filter((line) => line.sequence !== "" || line.price !== "");
  const errors = lines.map(lineError);
  const gross = filledLines.reduce((sum, line) => sum + (Number(line.price) || 0), 0);
  const overCeiling = usage?.remaining != null && gross > usage.remaining;
  const ready = Boolean(prescription) && hasAttachments && !overCeiling && filledLines.length > 0 && errors.every((error) => !error) && filledLines.every((line) => line.sequence !== "" && Number(line.price) > 0);

  const upload = (kind: AttachmentKind, original: File) => {
    setUploading(kind);
    startBusy(async () => {
      const prepared = await prepareFile(original);
      if ("error" in prepared) { setUploading(null); onError(`${ATTACHMENT_LABELS[kind]}: ${prepared.error}`); return; }
      const file = prepared.file;
      let prescriptionId = prescription?.id;
      if (!prescriptionId) {
        const created = await createPrescription();
        if (created.error || !created.prescriptionId) { setUploading(null); onError(created.error ?? "تعذر إنشاء الوصفة"); return; }
        prescriptionId = created.prescriptionId;
      }
      const formData = new FormData();
      formData.set("prescriptionId", prescriptionId);
      formData.set("kind", kind);
      formData.set("file", file);
      const response = await uploadPharmacyPrescriptionAttachment(formData);
      setUploading(null);
      if (response.error) onError(response.error);
      await reload();
    });
  };

  const review = () => {
    if (!prescription || !ready) return;
    const items = filledLines.map((line) => ({ sequence: Number(line.sequence), price: Number(line.price) }));
    const idempotencyKey = newKey();
    onReview({
      lines: items.map((item) => ({ label: `البند ${item.sequence} — ${title}`, price: item.price })),
      files: prescription.attachments.map((item) => item.file_name),
      submit: async () => {
        const result = await submit(prescription.id, items, idempotencyKey);
        if (!result?.error) setLines([{ key: newKey(), sequence: "", price: "" }]);
        return result;
      },
    });
  };

  return (
    <section aria-label={title} className={`space-y-3 rounded-xl border p-3 ${prescription ? "border-teal-200 dark:border-teal-900" : "border-dashed border-slate-300 dark:border-slate-700"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="text-base font-black">{title}</h3>
        <span className="text-xs font-bold text-slate-500">{prescription ? `أنشأها ${prescription.created_by_facility.name}` : "لم تُستخدم بعد: ارفع المرفقين للبدء"}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {(["INSURANCE_CARD", "PRESCRIPTION"] as const).map((kind) => (
          <FileZone key={kind} kind={kind} fileName={attachmentOf(kind)?.file_name ?? null} href={attachmentOf(kind) ? `/api/pharmacy/attachments/${attachmentOf(kind)!.id}` : undefined} busy={uploading === kind} disabled={busy && uploading !== kind} onPick={(file) => upload(kind, file)} />
        ))}
      </div>

      {dispensedSlots.length > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-black">مصروف مسبقًا: </span>
          {dispensedSlots.map((slot) => `البند ${slot.sequence} (${slot.dispensed_by_facility?.name ?? "مرفق آخر"})`).join("، ")}
        </p>
      )}

      {prescription && (
        <>
          <fieldset disabled={!hasAttachments || busy} className="space-y-2 disabled:opacity-50">
            <legend className="mb-1 text-sm font-black">رقم البند كما في الوصفة والسعر {!hasAttachments && <span className="text-xs font-bold text-amber-700">(ارفع المرفقين أولًا)</span>}</legend>
            {lines.map((line, index) => (
              <div key={line.key}>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
                  <Input aria-label={`رقم البند ${index + 1}`} placeholder="رقم البند" type="number" inputMode="numeric" dir="ltr" min="1" max="50" value={line.sequence} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, sequence: event.target.value } : item))} className="h-10" />
                  <Input aria-label={`سعر البند ${index + 1}`} placeholder="السعر (د.ل)" type="number" inputMode="decimal" dir="ltr" min="0" step="0.01" value={line.price} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, price: event.target.value } : item))} className="h-10" />
                  <button type="button" onClick={() => setLines((current) => current.length === 1 ? [{ key: newKey(), sequence: "", price: "" }] : current.filter((item) => item.key !== line.key))} aria-label={`حذف السطر ${index + 1}`} className="px-2 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                {errors[index] && <p className="mt-1 text-xs font-bold text-rose-600">{errors[index]}</p>}
              </div>
            ))}
            <button type="button" onClick={() => setLines((current) => [...current, { key: newKey(), sequence: "", price: "" }])} className="inline-flex items-center gap-1 text-sm font-black text-teal-700 hover:underline dark:text-teal-300"><Plus className="h-4 w-4" /> إضافة بند</button>
          </fieldset>

          <Totals prices={filledLines.map((line) => Number(line.price) || 0)} usage={usage} />
          <Button type="button" onClick={review} disabled={!ready || busy} className="h-10 w-full text-sm">مراجعة وتأكيد الصرف</Button>
        </>
      )}
    </section>
  );
}


function ChronicTab({
  drugs,
  orderCard,
  usage,
  intervalDays,
  onReview,
  submit,
}: {
  drugs: ChronicDrug[];
  /** صرف من طلب: تُستخدم بطاقة المستفيد المرسلة في المحادثة، وتُحدد أدويته المطلوبة مسبقًا. */
  orderCard: { orderId: string; preselect: string[] } | null;
  usage: Usage | undefined;
  intervalDays: number;
  onReview: (pending: PendingDispense) => void;
  submit: (items: Array<{ chronicDrugId: string; price: number }>, files: { INSURANCE_CARD?: File }, idempotencyKey: string) => Promise<{ error?: string } | undefined>;
}) {
  const [selected, setSelected] = useState<Record<string, string>>(() => Object.fromEntries(
    drugs.filter((drug) => drug.eligible && orderCard?.preselect.includes(drug.id)).map((drug) => [drug.id, drug.last_price ? String(drug.last_price) : ""]),
  ));
  // المزمن يحتاج صورة البطاقة التأمينية فقط.
  const [files, setFiles] = useState<{ INSURANCE_CARD?: File }>({});
  const [fileError, setFileError] = useState("");

  const chosen = drugs.filter((drug) => drug.id in selected);
  const prices = chosen.map((drug) => Number(selected[drug.id]) || 0);
  const overCeiling = usage?.remaining != null && prices.reduce((sum, price) => sum + price, 0) > usage.remaining;
  const ready = chosen.length > 0 && !overCeiling && prices.every((price) => price > 0) && Boolean(files.INSURANCE_CARD || orderCard);

  const pick = async (kind: AttachmentKind, original: File) => {
    const prepared = await prepareFile(original);
    if ("error" in prepared) { setFileError(`${ATTACHMENT_LABELS[kind]}: ${prepared.error}`); return; }
    setFileError("");
    setFiles((current) => ({ ...current, [kind]: prepared.file }));
  };

  const review = () => {
    if (!ready) return;
    const items = chosen.map((drug) => ({ chronicDrugId: drug.id, price: Number(selected[drug.id]) }));
    const idempotencyKey = newKey();
    const attached = { INSURANCE_CARD: files.INSURANCE_CARD };
    onReview({
      lines: chosen.map((drug) => ({ label: drug.drug_name, price: Number(selected[drug.id]) })),
      files: [attached.INSURANCE_CARD?.name ?? "البطاقة المرسلة في طلب المستفيد"],
      submit: async () => {
        const result = await submit(items, attached, idempotencyKey);
        if (!result?.error) { setSelected({}); setFiles({}); }
        return result;
      },
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">يُصرف كل دواء مرة كل {intervalDays} يومًا من أي مرفق. الأدوية المقفلة صُرفت خلال الدورة الحالية.</p>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {drugs.map((drug) => {
          const checked = drug.id in selected;
          return (
            <li key={drug.id} className={`grid gap-2 p-2.5 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center ${drug.eligible ? "" : "bg-slate-50 dark:bg-slate-900/50"}`}>
              <label className={`flex items-start gap-2 ${drug.eligible ? "cursor-pointer" : "cursor-not-allowed"}`}>
                <input type="checkbox" className="mt-1" disabled={!drug.eligible} checked={checked} onChange={() => setSelected((current) => { const next = { ...current }; if (checked) delete next[drug.id]; else next[drug.id] = drug.last_price ? String(drug.last_price) : ""; return next; })} />
                <span className="min-w-0">
                  <span className="block text-sm font-black" dir="auto">{drug.drug_name}</span>
                  {drug.notes && <span className="block text-xs text-slate-500" dir="auto">{drug.notes}</span>}
                  <span className={`mt-0.5 flex items-center gap-1 text-xs font-bold ${drug.eligible ? "text-slate-500" : "text-amber-700"}`}>
                    {!drug.eligible && <LockKeyhole className="h-3 w-3" aria-hidden />}
                    {drug.last_dispensed_at ? `آخر صرف ${tripoliDate(drug.last_dispensed_at)} لدى ${drug.last_facility_name}` : "لم يُصرف من قبل"}
                    {!drug.eligible && drug.next_eligible_at ? ` · متاح من ${tripoliDate(drug.next_eligible_at)}` : ""}
                  </span>
                </span>
              </label>
              {checked && <Input aria-label={`سعر ${drug.drug_name}`} placeholder="السعر (د.ل)" type="number" inputMode="decimal" dir="ltr" min="0" step="0.01" value={selected[drug.id]} onChange={(event) => setSelected((current) => ({ ...current, [drug.id]: event.target.value }))} className="h-10" />}
            </li>
          );
        })}
      </ul>

      <div className="sm:max-w-md">
        <FileZone kind="INSURANCE_CARD" fileName={files.INSURANCE_CARD?.name ?? (orderCard ? "البطاقة المرسلة في طلب المستفيد" : null)} onPick={(file) => pick("INSURANCE_CARD", file)} onClear={() => setFiles({})} />
      </div>
      {fileError && <p role="alert" className="text-sm font-bold text-rose-600">{fileError}</p>}

      <Totals prices={prices} usage={usage} />
      <Button type="button" onClick={review} disabled={!ready} className="h-10 w-full text-sm">
        {chosen.length === 0 ? "اختر دواءً واحدًا على الأقل" : !files.INSURANCE_CARD && !orderCard ? "أرفق صورة البطاقة التأمينية" : "مراجعة وتأكيد الصرف"}
      </Button>
    </div>
  );
}

function ReviewDialog({ pending, usage, categoryLabel, onClose, onDone }: { pending: PendingDispense; usage: Usage | undefined; categoryLabel: string; onClose: () => void; onDone: (error?: string) => void }) {
  const [submitting, startSubmit] = useTransition();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const totals = useMemo(() => estimate(pending.lines.map((line) => line.price), usage), [pending, usage]);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const confirm = () => startSubmit(async () => {
    const result = await pending.submit();
    onDone(result?.error);
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" dir="rtl">
      <div role="dialog" aria-modal="true" aria-labelledby="dispense-review-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:rounded-2xl">
        <h2 id="dispense-review-title" className="text-lg font-black">تأكيد صرف {categoryLabel}</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {pending.lines.map((line, index) => (
            <li key={index} className="flex justify-between gap-3 py-1.5"><span dir="auto">{line.label}</span><span className="tabular-nums">{money(line.price)}</span></li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
          <dt className="text-slate-500">الإجمالي</dt><dd className="text-left font-black tabular-nums">{money(totals.gross)}</dd>
          <dt className="text-slate-500">حصة الشركة (تقديرية)</dt><dd className="text-left font-black tabular-nums text-teal-700 dark:text-teal-400">{money(totals.company)}</dd>
          <dt className="text-slate-500">على المستفيد</dt><dd className="text-left font-black tabular-nums text-amber-700 dark:text-amber-400">{money(totals.patient)}</dd>
          {totals.remainingAfter !== null && <><dt className="text-slate-500">المتبقي من السقف بعد الصرف</dt><dd className="text-left font-black tabular-nums">{money(totals.remainingAfter)}</dd></>}
        </dl>
        <p className="mt-2 text-xs text-slate-500">المرفقات: {pending.files.join("، ")}</p>
        <p className="mt-1 text-xs text-slate-500">يُعاد احتساب الحصص على الخادم عند التأكيد، وتُعتمد القيم المسجلة في السجل.</p>
        <div className="mt-4 flex gap-2">
          <Button ref={confirmRef} type="button" onClick={confirm} disabled={submitting} className="h-10 flex-1 text-sm">{submitting && <Loader2 className="h-4 w-4 animate-spin" />} تأكيد الصرف</Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="h-10 text-sm">رجوع</Button>
        </div>
      </div>
    </div>
  );
}
