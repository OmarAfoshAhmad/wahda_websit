"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Bike, Camera, Check, ChevronLeft, Home, Image as ImageIcon, Loader2, LocateFixed, MapPin, MessageCircle, Pill, Search, Store } from "lucide-react";
import { createPharmacyOrder, listPharmaciesForBeneficiary } from "@/app/actions/pharmacy-orders";
import { prepareFile } from "@/lib/pharmacy/client-files";
import { CameraButton } from "@/components/pharmacy/camera-capture";
import { getCurrentLocation, type GeoPoint } from "@/lib/geo-client";
import type { ChronicDrugStatus } from "@/lib/pharmacy/summary";

/**
 * طلب دواء من صيدلية كخطوات بسيطة: قرار واحد في كل شاشة، أزرار كبيرة، ولغة بسيطة.
 * صُمم لمستفيدين خبرتهم بالتقنية قليلة. التحقق النهائي يبقى في الخادم (createPharmacyOrder).
 */

type Category = "ROUTINE" | "CHRONIC" | "CHEMICAL";
type Pharmacy = Awaited<ReturnType<typeof listPharmaciesForBeneficiary>>["items"][number];
type OrderItem = { id: string; category: string; status: string; facilityName: string; unread: number; updatedAt: string };
type Step = "pharmacy" | "type" | "photos" | "receive" | "review";

const CATEGORY_TEXT: Record<Category, { title: string; hint: string }> = {
  ROUTINE: { title: "دواء عادي", hint: "بوصفة من الطبيب" },
  CHRONIC: { title: "دوائي الشهري", hint: "أدوية الأمراض المزمنة" },
  CHEMICAL: { title: "دواء الأورام", hint: "بوصفة من الطبيب" },
};
const OPEN_STATUSES = ["PENDING", "AVAILABLE", "CONFIRMED", "OUT_FOR_DELIVERY"];
const SEARCH_THRESHOLD = 8;

const normalizeArabic = (value: string) => value.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
const dateText = (iso: string) => new Date(iso).toLocaleDateString("ar-LY", { timeZone: "Africa/Tripoli", day: "numeric", month: "long" });

/** زر اختيار كبير: عنوان واضح وسطر واحد مساعد. */
function BigChoice({ selected, disabled, onClick, icon, title, subtitle, note }: { selected?: boolean; disabled?: boolean; onClick: () => void; icon?: React.ReactNode; title: string; subtitle?: React.ReactNode; note?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={Boolean(selected)}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-19 w-full items-center gap-4 rounded-2xl border-2 px-4 py-3 text-start transition disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-primary bg-primary-light" : "border-slate-200 bg-white active:bg-primary-light dark:border-slate-700 dark:bg-slate-900"}`}
    >
      {icon && <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-black leading-snug text-slate-900 dark:text-white">{title}</span>
        {subtitle && <span className="mt-0.5 block text-base text-slate-600 dark:text-slate-300">{subtitle}</span>}
        {note && <span className="mt-0.5 block text-base font-bold text-amber-700 dark:text-amber-400">{note}</span>}
      </span>
      {selected ? <Check className="h-7 w-7 shrink-0 text-primary" aria-hidden /> : <ChevronLeft className="h-6 w-6 shrink-0 text-slate-400" aria-hidden />}
    </button>
  );
}

/** مربع تصوير كبير مع معاينة الصورة الملتقطة. */
function PhotoTile({ label, file, preparing, onPick }: { label: string; file: File | null; preparing: boolean; onPick: (file: File) => void }) {
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  // الضغط على البطاقة يفتح الكاميرا مباشرة (الجوال والكمبيوتر)، ورابط صغير للاختيار من الصور الموجودة.
  return (
    <div className="space-y-1.5">
      <CameraButton
        label={file ? `${label}: إعادة التصوير` : `${label}: تصوير`}
        disabled={preparing}
        onCapture={onPick}
        className={`relative flex min-h-42.5 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed p-4 text-center focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 ${file ? "border-primary bg-primary-light" : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"}`}
      >
        {preparing ? (
          <><Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden /><span className="text-lg font-bold">جارٍ تجهيز الصورة…</span></>
        ) : file ? (
          <>
            {preview
              // eslint-disable-next-line @next/next/no-img-element -- معاينة محلية من الجهاز
              ? <img src={preview} alt={label} className="max-h-32 rounded-lg object-contain" />
              : <Check className="h-10 w-10 text-primary" aria-hidden />}
            <span className="text-lg font-black text-primary">تم ✓ — اضغط لإعادة التصوير</span>
          </>
        ) : (
          <>
            <Camera className="h-12 w-12 text-primary" aria-hidden />
            <span className="text-xl font-black text-slate-900 dark:text-white">{label}</span>
            <span className="text-base text-slate-600 dark:text-slate-300">اضغط هنا للتصوير</span>
          </>
        )}
      </CameraButton>
      <label className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-base font-bold text-primary focus-within:ring-2 focus-within:ring-primary/30 dark:text-teal-300">
        <ImageIcon className="h-5 w-5" aria-hidden /> أو اختر صورة من الجهاز
        <input type="file" accept="image/*,application/pdf" className="sr-only" aria-label={label} onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) onPick(picked); }} />
      </label>
    </div>
  );
}

export function PharmacyOrderClient({ categories, chronicDrugs, contextError, orders }: { categories: Category[]; chronicDrugs: ChronicDrugStatus[]; contextError: string | null; orders: OrderItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // الاختيارات محفوظة هنا، فالرجوع بين الخطوات لا يُضيع شيئًا.
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [chronicIds, setChronicIds] = useState<string[]>([]);
  const [cardFile, setCardFile] = useState<File | null>(null);
  const [rxFile, setRxFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState<"card" | "rx" | null>(null);
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY" | null>(null);
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [stepError, setStepError] = useState("");
  const [submitting, startSubmit] = useTransition();

  const [pharmacies, setPharmacies] = useState<Pharmacy[] | null>(null);
  const [listError, setListError] = useState("");
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationHint, setLocationHint] = useState("");
  const [query, setQuery] = useState("");

  // الصيدلية تُقرأ من آخر قائمة محمّلة (لا نسخة قديمة) حتى تتحدث قيمة التوصيل بعد تحديد الموقع.
  const pharmacy = pharmacies?.find((item) => item.facilityId === facilityId) ?? null;
  const eligibleChronic = chronicDrugs.filter((drug) => drug.eligible);
  const notDueChronic = chronicDrugs.filter((drug) => !drug.eligible);
  const openOrder = orders.find((order) => OPEN_STATUSES.includes(order.status));

  const loadPharmacies = useCallback((point: GeoPoint | null) => {
    return listPharmaciesForBeneficiary(point ?? {})
      .then((result) => {
        if ("error" in result && result.error) { setListError(result.error); return; }
        setListError("");
        setPharmacies(result.items);
      })
      .catch(() => setListError("تعذر تحميل الصيدليات. تأكد من الاتصال بالإنترنت ثم أعد المحاولة"));
  }, []);

  useEffect(() => { void loadPharmacies(null); }, [loadPharmacies]);

  // الموقع يُطلب فقط عند الحاجة وبضغطة من المستفيد.
  const requestMyLocation = () => {
    setLocating(true);
    setLocationHint("");
    getCurrentLocation()
      .then(async (point) => { setLocation(point); await loadPharmacies(point); })
      .catch(() => setLocationHint("لم نتمكن من معرفة موقعك. يمكنك اختيار الصيدلية بنفسك"))
      .finally(() => setLocating(false));
  };

  const steps: Step[] = ["pharmacy", "type", "photos", "receive", "review"];
  // الخطوة من الرابط (حتى يعمل زر الرجوع في الهاتف)، ولا يُسمح بتجاوز خطوة لم تكتمل.
  const requestedIndex = Math.max(0, steps.indexOf((searchParams?.get("step") ?? "pharmacy") as Step));
  const maxIndex = !pharmacy ? 0 : !category ? 1 : steps.length - 1;
  const step: Step = steps[Math.min(requestedIndex, maxIndex)];
  const stepNumber = steps.indexOf(step) + 1;

  const goTo = (next: Step) => {
    setStepError("");
    router.push(`/beneficiary/pharmacy?step=${next}`, { scroll: false });
  };
  // زر الرجوع في الهاتف يعيد خطوة واحدة لأن كل خطوة في سجل التصفح.
  const goBack = () => (stepNumber > 1 ? router.back() : router.push("/beneficiary/dashboard"));

  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [step]);

  const pickFile = async (kind: "card" | "rx", original: File) => {
    setStepError("");
    setPreparing(kind);
    const prepared = await prepareFile(original);
    setPreparing(null);
    if ("error" in prepared) { setStepError("لم نستطع قراءة هذه الصورة. حاول التصوير مرة أخرى"); return; }
    if (kind === "card") setCardFile(prepared.file); else setRxFile(prepared.file);
  };

  const needsRx = category !== "CHRONIC";
  const photosNext = () => {
    if (!cardFile) return setStepError("صوّر بطاقة التأمين أولًا");
    if (needsRx && !rxFile) return setStepError("صوّر الوصفة أولًا");
    if (category === "CHRONIC" && chronicIds.length === 0) return setStepError("اختر دواءً واحدًا على الأقل");
    goTo("receive");
  };
  const receiveNext = () => {
    if (!fulfillment) return setStepError("اختر طريقة الاستلام");
    if (fulfillment === "DELIVERY" && !location) return setStepError("اضغط «استخدم موقعي» حتى نعرف أين نوصل الدواء");
    if (fulfillment === "DELIVERY" && !address.trim()) return setStepError("اكتب وصفًا لعنوان البيت");
    goTo("review");
  };

  const submit = () => {
    if (!pharmacy || !category || !cardFile || !fulfillment) return;
    setStepError("");
    startSubmit(async () => {
      const formData = new FormData();
      formData.set("facilityId", pharmacy.facilityId);
      formData.set("category", category);
      formData.set("fulfillment", fulfillment);
      formData.set("note", note);
      formData.set("address", fulfillment === "DELIVERY" ? address : "");
      if (location) { formData.set("latitude", String(location.latitude)); formData.set("longitude", String(location.longitude)); }
      formData.set("chronicDrugIds", JSON.stringify(category === "CHRONIC" ? chronicIds : []));
      formData.set("insuranceCard", cardFile);
      if (needsRx && rxFile) formData.set("prescription", rxFile);
      const result = await createPharmacyOrder(formData);
      if ("error" in result && result.error) { setStepError(result.error); return; }
      if ("orderId" in result && result.orderId) router.replace(`/beneficiary/orders/${result.orderId}`);
    });
  };

  const visiblePharmacies = useMemo(() => {
    const list = pharmacies ?? [];
    const needle = normalizeArabic(query);
    const filtered = needle ? list.filter((item) => normalizeArabic([item.name, item.city, item.address].filter(Boolean).join(" ")).includes(needle)) : list;
    return { open: filtered.filter((item) => item.openNow), closed: filtered.filter((item) => !item.openNow) };
  }, [pharmacies, query]);

  const titles: Record<Step, string> = {
    pharmacy: "اختر الصيدلية",
    type: "ما نوع الدواء؟",
    photos: category === "CHRONIC" ? "صوّر البطاقة واختر أدويتك" : "صوّر البطاقة والوصفة",
    receive: "كيف تستلم الدواء؟",
    review: "راجع طلبك",
  };

  const pharmacyButton = (item: Pharmacy) => (
    <BigChoice
      key={item.facilityId}
      selected={facilityId === item.facilityId}
      onClick={() => { setFacilityId(item.facilityId); goTo("type"); }}
      icon={<Store className="h-6 w-6" aria-hidden />}
      title={item.name}
      subtitle={[
        item.distanceKm !== null ? `${item.distanceKm} كم` : item.city,
        item.openNow ? "مفتوحة الآن" : "مغلقة الآن",
        item.delivery.available ? "يوجد توصيل" : null,
      ].filter(Boolean).join(" · ")}
    />
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-32 pt-4">
      <header className="mb-5 flex items-center gap-3">
        <button type="button" onClick={goBack} className="inline-flex h-14 items-center gap-1 rounded-2xl border-2 border-slate-200 bg-white px-4 text-lg font-bold dark:border-slate-700 dark:bg-slate-900">
          <ArrowRight className="h-6 w-6" aria-hidden /> رجوع
        </button>
        <span className="text-base font-bold text-slate-500 dark:text-slate-400">خطوة {stepNumber} من {steps.length}</span>
      </header>
      <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(stepNumber / steps.length) * 100}%` }} />
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="mb-4 text-2xl font-black text-slate-900 outline-none dark:text-white">{titles[step]}</h1>

      {contextError ? (
        <p className="rounded-2xl bg-rose-50 p-4 text-lg font-bold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{contextError}</p>
      ) : (
        <>
          {step === "pharmacy" && (
            <div className="space-y-3">
              {openOrder && (
                <Link href={`/beneficiary/orders/${openOrder.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-lg font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <MessageCircle className="h-6 w-6 shrink-0" aria-hidden />
                  <span className="flex-1">لديك طلب مفتوح عند {openOrder.facilityName} — اضغط لمتابعته</span>
                </Link>
              )}
              {!location && (
                <button type="button" onClick={requestMyLocation} disabled={locating} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary-light px-4 text-lg font-bold text-primary disabled:opacity-60">
                  {locating ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <LocateFixed className="h-6 w-6" aria-hidden />}
                  {locating ? "جارٍ تحديد موقعك…" : "أظهر الأقرب إليّ"}
                </button>
              )}
              {locationHint && <p className="text-base text-slate-600 dark:text-slate-300">{locationHint}</p>}
              {pharmacies && pharmacies.length > SEARCH_THRESHOLD && (
                <div className="relative">
                  <Search className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="اكتب اسم الصيدلية" aria-label="اكتب اسم الصيدلية" className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-white pr-12 pl-4 text-lg dark:border-slate-700 dark:bg-slate-900" />
                </div>
              )}
              {listError ? (
                <div className="space-y-3 rounded-2xl bg-rose-50 p-4 dark:bg-rose-950/40">
                  <p className="text-lg font-bold text-rose-800 dark:text-rose-200">{listError}</p>
                  <button type="button" onClick={() => void loadPharmacies(location)} className="h-12 rounded-xl bg-white px-4 text-lg font-bold text-rose-800 dark:bg-slate-900 dark:text-rose-200">أعد المحاولة</button>
                </div>
              ) : pharmacies === null ? (
                <div className="space-y-3" aria-label="جارٍ التحميل">{[0, 1, 2].map((key) => <div key={key} className="h-19 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}</div>
              ) : pharmacies.length === 0 ? (
                <p className="rounded-2xl bg-white p-6 text-center text-lg text-slate-600 dark:bg-slate-900 dark:text-slate-300">لا توجد صيدليات تستقبل الطلبات الآن</p>
              ) : (
                <div className="space-y-3" role="radiogroup" aria-label="الصيدليات">
                  {visiblePharmacies.open.map(pharmacyButton)}
                  {visiblePharmacies.closed.length > 0 && (
                    <>
                      <p className="pt-2 text-base font-bold text-slate-500 dark:text-slate-400">مغلقة الآن (يمكنك الطلب وسترد عليك عند الفتح)</p>
                      {visiblePharmacies.closed.map(pharmacyButton)}
                    </>
                  )}
                  {visiblePharmacies.open.length + visiblePharmacies.closed.length === 0 && <p className="p-4 text-center text-lg text-slate-600">لا توجد صيدلية بهذا الاسم</p>}
                </div>
              )}
            </div>
          )}

          {step === "type" && (
            <div className="space-y-3" role="radiogroup" aria-label="نوع الدواء">
              {categories.length === 0 && <p className="rounded-2xl bg-amber-50 p-4 text-lg font-bold text-amber-900">تأمينك لا يشمل طلب الأدوية حاليًا. تواصل مع شركتك</p>}
              {categories.map((value) => {
                const noneDue = value === "CHRONIC" && eligibleChronic.length === 0;
                const nextDate = notDueChronic.map((drug) => drug.next_eligible_at).filter(Boolean).sort()[0];
                return (
                  <BigChoice
                    key={value}
                    selected={category === value}
                    disabled={noneDue}
                    onClick={() => { setCategory(value); goTo("photos"); }}
                    icon={<Pill className="h-6 w-6" aria-hidden />}
                    title={CATEGORY_TEXT[value].title}
                    subtitle={CATEGORY_TEXT[value].hint}
                    note={noneDue ? (nextDate ? `أدويتك جاهزة من ${dateText(nextDate)}` : "لا توجد أدوية جاهزة الآن") : undefined}
                  />
                );
              })}
            </div>
          )}

          {step === "photos" && (
            <div className="space-y-4">
              <PhotoTile label="صورة بطاقة التأمين" file={cardFile} preparing={preparing === "card"} onPick={(file) => void pickFile("card", file)} />
              {needsRx ? (
                <PhotoTile label="صورة الوصفة" file={rxFile} preparing={preparing === "rx"} onPick={(file) => void pickFile("rx", file)} />
              ) : (
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-xl font-black">اختر الأدوية التي تريدها</legend>
                  {eligibleChronic.map((drug) => {
                    const checked = chronicIds.includes(drug.id);
                    return (
                      <label key={drug.id} className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl border-2 px-4 py-3 ${checked ? "border-primary bg-primary-light" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
                        <input type="checkbox" className="h-7 w-7 accent-(--primary)" checked={checked} onChange={(event) => setChronicIds((current) => event.target.checked ? [...current, drug.id] : current.filter((id) => id !== drug.id))} />
                        <span className="text-lg font-bold" dir="auto">{drug.drug_name}</span>
                      </label>
                    );
                  })}
                  {notDueChronic.length > 0 && (
                    <details className="rounded-2xl bg-slate-50 p-4 text-base dark:bg-slate-900">
                      <summary className="cursor-pointer text-lg font-bold text-slate-600 dark:text-slate-300">أدوية لم يحن موعدها ({notDueChronic.length})</summary>
                      <ul className="mt-2 space-y-1">{notDueChronic.map((drug) => <li key={drug.id} dir="auto">{drug.drug_name} — من {drug.next_eligible_at ? dateText(drug.next_eligible_at) : "قريبًا"}</li>)}</ul>
                    </details>
                  )}
                </fieldset>
              )}
            </div>
          )}

          {step === "receive" && pharmacy && (
            <div className="space-y-3" role="radiogroup" aria-label="طريقة الاستلام">
              <BigChoice selected={fulfillment === "PICKUP"} onClick={() => { setFulfillment("PICKUP"); setStepError(""); }} icon={<Store className="h-6 w-6" aria-hidden />} title="أستلمه من الصيدلية" subtitle="بدون أي مبلغ إضافي" />
              {pharmacy.delivery.available || !location ? (
                <BigChoice
                  selected={fulfillment === "DELIVERY"}
                  onClick={() => { setFulfillment("DELIVERY"); setStepError(""); }}
                  icon={<Bike className="h-6 w-6" aria-hidden />}
                  title="توصيل للبيت"
                  subtitle={pharmacy.delivery.available ? `+ ${pharmacy.delivery.fee} دينار تدفعها عند الاستلام` : "نحتاج موقعك لمعرفة قيمة التوصيل"}
                />
              ) : (
                <p className="rounded-2xl bg-slate-100 p-4 text-lg text-slate-700 dark:bg-slate-800 dark:text-slate-200">هذه الصيدلية لا توصّل إلى موقعك</p>
              )}
              {fulfillment === "DELIVERY" && (
                <div className="space-y-3 pt-2">
                  {!location && (
                    <button type="button" onClick={requestMyLocation} disabled={locating} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-lg font-bold text-white disabled:opacity-60">
                      {locating ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <MapPin className="h-6 w-6" aria-hidden />} استخدم موقعي
                    </button>
                  )}
                  {locationHint && <p className="text-base text-amber-800 dark:text-amber-300">{locationHint}</p>}
                  <label className="block">
                    <span className="mb-1 block text-lg font-bold">أين البيت؟</span>
                    <input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} placeholder="مثال: الفويهات، قرب المسجد" className="h-14 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 text-lg dark:border-slate-700 dark:bg-slate-900" />
                  </label>
                </div>
              )}
            </div>
          )}

          {step === "review" && pharmacy && category && (
            <div className="space-y-3">
              <dl className="divide-y divide-slate-100 rounded-2xl bg-white text-lg dark:divide-slate-800 dark:bg-slate-900">
                {[
                  ["الصيدلية", pharmacy.name],
                  ["الدواء", category === "CHRONIC" ? `${CATEGORY_TEXT.CHRONIC.title} (${chronicIds.length})` : CATEGORY_TEXT[category].title],
                  ["الاستلام", fulfillment === "DELIVERY" ? `توصيل للبيت + ${pharmacy.delivery.available ? pharmacy.delivery.fee : "—"} دينار` : "من الصيدلية"],
                  ["الصور", needsRx ? "البطاقة والوصفة ✓" : "البطاقة ✓"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 px-4 py-3"><dt className="text-slate-500 dark:text-slate-400">{label}</dt><dd className="text-end font-bold">{value}</dd></div>
                ))}
              </dl>
              {showNote ? (
                <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} autoFocus placeholder="اكتب ملاحظتك للصيدلية" aria-label="ملاحظة للصيدلية" className="w-full rounded-2xl border-2 border-slate-200 bg-white p-4 text-lg dark:border-slate-700 dark:bg-slate-900" />
              ) : (
                <button type="button" onClick={() => setShowNote(true)} className="h-12 text-lg font-bold text-primary underline-offset-4 hover:underline">+ أضف ملاحظة للصيدلية</button>
              )}
              <p className="text-base text-slate-600 dark:text-slate-300">بعد الإرسال ستتحقق الصيدلية من توفر الدواء وترد عليك.</p>
            </div>
          )}
        </>
      )}

      {stepError && <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-lg font-bold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{stepError}</p>}

      {!contextError && (step === "photos" || step === "receive" || step === "review") && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="mx-auto max-w-md">
            {step === "review" ? (
              <button type="button" onClick={submit} disabled={submitting} className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-xl font-black text-white disabled:opacity-60">
                {submitting && <Loader2 className="h-6 w-6 animate-spin" aria-hidden />} {submitting ? "جارٍ الإرسال…" : "أرسل الطلب"}
              </button>
            ) : (
              <button type="button" onClick={step === "photos" ? photosNext : receiveNext} disabled={preparing !== null} className="h-16 w-full rounded-2xl bg-primary text-xl font-black text-white disabled:opacity-60">التالي</button>
            )}
          </div>
        </div>
      )}

      {step === "pharmacy" && (
        <Link href="/beneficiary/dashboard" className="mt-6 inline-flex h-12 items-center justify-center gap-2 self-center text-lg font-bold text-slate-500"><Home className="h-5 w-5" aria-hidden /> الصفحة الرئيسية</Link>
      )}
    </div>
  );
}
