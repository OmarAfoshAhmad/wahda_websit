"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bike, Clock, Loader2, LocateFixed, MapPin, MessageCircle, Phone, Store, Upload } from "lucide-react";
import { createPharmacyOrder, listPharmaciesForBeneficiary } from "@/app/actions/pharmacy-orders";
import { ACCEPTED_FILES, prepareFile } from "@/lib/pharmacy/client-files";
import { OrderStatusBadge } from "@/components/pharmacy/order-chat";
import type { ChronicDrugStatus } from "@/lib/pharmacy/summary";

type Category = "ROUTINE" | "CHRONIC" | "CHEMICAL";
type Pharmacy = Awaited<ReturnType<typeof listPharmaciesForBeneficiary>>["items"][number];
type OrderItem = { id: string; category: string; status: string; facilityName: string; unread: number; updatedAt: string };

const CATEGORY_LABELS: Record<Category, string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدويتي المزمنة", CHEMICAL: "أدوية الأورام" };
const card = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900";

function FilePick({ label, file, onPick }: { label: string; file: File | null; onPick: (file: File) => void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 focus-within:ring-2 focus-within:ring-teal-500 ${file ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-slate-300 dark:border-slate-700"}`}>
      <Upload className={`h-5 w-5 shrink-0 ${file ? "text-emerald-600" : "text-slate-400"}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black">{label} <span className="text-red-500" aria-hidden>*</span></span>
        <span className="block truncate text-xs text-slate-500">{file ? file.name : "صورة أو PDF · اضغط للتصوير أو الاختيار"}</span>
      </span>
      <input type="file" accept={ACCEPTED_FILES} className="sr-only" aria-label={label} onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) onPick(picked); }} />
    </label>
  );
}

export function PharmacyOrderClient({ categories, chronicDrugs, contextError, orders }: { categories: Category[]; chronicDrugs: ChronicDrugStatus[]; contextError: string | null; orders: OrderItem[] }) {
  const router = useRouter();
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(true);
  const [locationNote, setLocationNote] = useState("");
  const [pharmacies, setPharmacies] = useState<Pharmacy[] | null>(null);
  const [selected, setSelected] = useState<Pharmacy | null>(null);
  const [category, setCategory] = useState<Category | null>(categories[0] ?? null);
  const [chronicIds, setChronicIds] = useState<string[]>([]);
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [cardFile, setCardFile] = useState<File | null>(null);
  const [rxFile, setRxFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, startSubmit] = useTransition();

  // يُطلب الموقع عند الدخول لترتيب الصيدليات وحساب التوصيل؛ إن رفض المستفيد تظهر القائمة بلا مسافات.
  useEffect(() => {
    const load = (point: { latitude: number; longitude: number } | null) => {
      listPharmaciesForBeneficiary(point ?? {}).then((result) => { setPharmacies(result.items); setLocating(false); });
    };
    if (!navigator.geolocation) {
      Promise.resolve().then(() => { setLocationNote("المتصفح لا يدعم تحديد الموقع"); load(null); });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => { const point = { latitude: position.coords.latitude, longitude: position.coords.longitude }; setLocation(point); load(point); },
      () => { setLocationNote("لم تشارك موقعك: الصيدليات غير مرتبة بالمسافة، والتوصيل بحسب المسافة غير متاح"); load(null); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
    );
  }, []);

  const pickFile = async (file: File, setter: (file: File) => void) => {
    const prepared = await prepareFile(file);
    if ("error" in prepared) { setError(prepared.error); return; }
    setError("");
    setter(prepared.file);
  };

  const eligibleChronic = chronicDrugs.filter((drug) => drug.eligible);
  const needsRx = category !== "CHRONIC";
  const ready = selected && category && cardFile && (!needsRx || rxFile) && (category !== "CHRONIC" || chronicIds.length > 0) && (fulfillment === "PICKUP" || (selected.delivery.available && location));

  const submit = () => {
    if (!ready || !selected || !category) return;
    setError("");
    startSubmit(async () => {
      const formData = new FormData();
      formData.set("facilityId", selected.facilityId);
      formData.set("category", category);
      formData.set("fulfillment", fulfillment);
      formData.set("note", note);
      formData.set("address", address);
      if (location) { formData.set("latitude", String(location.latitude)); formData.set("longitude", String(location.longitude)); }
      formData.set("chronicDrugIds", JSON.stringify(chronicIds));
      formData.set("insuranceCard", cardFile!);
      if (needsRx && rxFile) formData.set("prescription", rxFile);
      const result = await createPharmacyOrder(formData);
      if ("error" in result && result.error) { setError(result.error); return; }
      if ("orderId" in result && result.orderId) router.push(`/beneficiary/orders/${result.orderId}`);
    });
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-md space-y-4 px-4 pb-10 pt-5">
      <div className="flex items-center gap-2">
        <Link href="/beneficiary/dashboard" aria-label="رجوع" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><ArrowRight className="h-5 w-5" /></Link>
        <h1 className="text-lg font-black text-slate-900 dark:text-white">اطلب دواءك من صيدلية</h1>
      </div>

      {orders.length > 0 && (
        <section className={card} aria-labelledby="my-orders">
          <h2 id="my-orders" className="mb-2 text-sm font-black">طلباتي</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {orders.map((order) => (
              <li key={order.id}>
                <Link href={`/beneficiary/orders/${order.id}`} className="flex items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{order.facilityName}</span>
                    <OrderStatusBadge status={order.status} />
                  </span>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    {order.unread > 0 && <span className="rounded-full bg-rose-600 px-1.5 font-black text-white">{order.unread}</span>}
                    <MessageCircle className="h-4 w-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {contextError ? <p className={`${card} text-sm font-bold text-rose-700`}>{contextError}</p> : (
        <>
          <section className={card} aria-labelledby="choose-pharmacy">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="choose-pharmacy" className="text-sm font-black">1. اختر الصيدلية</h2>
              {location && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><LocateFixed className="h-3.5 w-3.5" /> حسب موقعك</span>}
            </div>
            {locationNote && <p className="mb-2 text-xs text-amber-700">{locationNote}</p>}
            {locating || pharmacies === null ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحديد موقعك وتحميل الصيدليات</p>
            ) : pharmacies.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">لا توجد صيدليات تستقبل الطلبات حاليًا</p>
            ) : (
              <ul className="space-y-2" role="radiogroup" aria-label="الصيدليات">
                {pharmacies.map((pharmacy) => {
                  const active = selected?.facilityId === pharmacy.facilityId;
                  return (
                    <li key={pharmacy.facilityId}>
                      <button type="button" role="radio" aria-checked={active} onClick={() => { setSelected(pharmacy); if (!pharmacy.delivery.available) setFulfillment("PICKUP"); }} className={`w-full rounded-xl border p-3 text-start ${active ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500 dark:bg-teal-950/30" : "border-slate-200 dark:border-slate-700"}`}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-sm font-black">{pharmacy.name}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${pharmacy.openNow ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{pharmacy.openNow ? "مفتوحة" : "مغلقة الآن"}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                          {pharmacy.distanceKm !== null && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {pharmacy.distanceKm} كم</span>}
                          {(pharmacy.address || pharmacy.city) && <span>{[pharmacy.city, pharmacy.address].filter(Boolean).join(" · ")}</span>}
                          {pharmacy.hours && <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" /> {pharmacy.hours}</span>}
                        </span>
                        <span className={`mt-1 flex items-center gap-1 text-xs font-bold ${pharmacy.delivery.available ? "text-teal-700 dark:text-teal-300" : "text-slate-500"}`}>
                          <Bike className="h-3.5 w-3.5" /> {pharmacy.delivery.available ? `توصيل ${pharmacy.delivery.fee} د.ل (خارج التأمين)` : pharmacy.delivery.reason}
                        </span>
                      </button>
                      {active && pharmacy.phone && <a href={`tel:${pharmacy.phone}`} className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-teal-700 dark:text-teal-300" dir="ltr"><Phone className="h-3 w-3" /> {pharmacy.phone}</a>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {selected && (
            <section className={`${card} space-y-3`} aria-labelledby="order-details">
              <h2 id="order-details" className="text-sm font-black">2. تفاصيل الطلب</h2>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="نوع الأدوية">
                {(["ROUTINE", "CHRONIC", "CHEMICAL"] as const).map((value) => {
                  const allowed = categories.includes(value);
                  return (
                    <button key={value} type="button" role="radio" aria-checked={category === value} disabled={!allowed} onClick={() => setCategory(value)} className={`rounded-xl border p-2 text-xs font-black ${category === value ? "border-teal-500 bg-teal-50 dark:bg-teal-950/30" : "border-slate-200 dark:border-slate-700"} disabled:opacity-40`}>
                      {CATEGORY_LABELS[value]}
                    </button>
                  );
                })}
              </div>

              {category === "CHRONIC" && (
                <fieldset className="space-y-1">
                  <legend className="mb-1 text-xs font-bold text-slate-500">اختر الأدوية المستحقة الآن</legend>
                  {chronicDrugs.map((drug) => (
                    <label key={drug.id} className={`flex items-start gap-2 rounded-lg p-1.5 text-sm ${drug.eligible ? "" : "opacity-50"}`}>
                      <input type="checkbox" className="mt-1" disabled={!drug.eligible} checked={chronicIds.includes(drug.id)} onChange={(event) => setChronicIds((current) => event.target.checked ? [...current, drug.id] : current.filter((id) => id !== drug.id))} />
                      <span><span className="font-bold" dir="auto">{drug.drug_name}</span>{!drug.eligible && drug.next_eligible_at && <span className="block text-xs">متاح من {new Date(drug.next_eligible_at).toLocaleDateString("ar-LY", { timeZone: "Africa/Tripoli" })}</span>}</span>
                    </label>
                  ))}
                  {eligibleChronic.length === 0 && <p className="text-xs font-bold text-amber-700">لا يوجد دواء مزمن مستحق الآن</p>}
                </fieldset>
              )}

              <FilePick label="صورة البطاقة التأمينية" file={cardFile} onPick={(file) => pickFile(file, setCardFile)} />
              {needsRx && <FilePick label="صورة الوصفة" file={rxFile} onPick={(file) => pickFile(file, setRxFile)} />}

              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="طريقة الاستلام">
                <button type="button" role="radio" aria-checked={fulfillment === "PICKUP"} onClick={() => setFulfillment("PICKUP")} className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs font-black ${fulfillment === "PICKUP" ? "border-teal-500 bg-teal-50 dark:bg-teal-950/30" : "border-slate-200 dark:border-slate-700"}`}>
                  <Store className="h-5 w-5" /> أستلمه بنفسي
                </button>
                <button type="button" role="radio" aria-checked={fulfillment === "DELIVERY"} disabled={!selected.delivery.available} onClick={() => setFulfillment("DELIVERY")} className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs font-black disabled:opacity-40 ${fulfillment === "DELIVERY" ? "border-teal-500 bg-teal-50 dark:bg-teal-950/30" : "border-slate-200 dark:border-slate-700"}`}>
                  <Bike className="h-5 w-5" /> توصيل {selected.delivery.available ? `${selected.delivery.fee} د.ل` : ""}
                </button>
              </div>
              {fulfillment === "DELIVERY" && (
                <>
                  <p className="rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">قيمة التوصيل {selected.delivery.available ? selected.delivery.fee : ""} د.ل خارج التأمين، تدفعها نقدًا عند الاستلام.</p>
                  <input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} placeholder="وصف العنوان: الحي، الشارع، علامة مميزة" aria-label="وصف العنوان" className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                </>
              )}
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} placeholder="ملاحظة للصيدلية (اختياري)" aria-label="ملاحظة للصيدلية" className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />

              {error && <p role="alert" className="text-sm font-bold text-rose-600">{error}</p>}
              <button type="button" onClick={submit} disabled={!ready || submitting} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-black text-white disabled:opacity-40">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />} إرسال الطلب ومحادثة الصيدلية
              </button>
              <p className="text-center text-xs text-slate-500">ستتحقق الصيدلية من توفر الأدوية وترد عليك في المحادثة.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
