"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, LocateFixed, MapPin } from "lucide-react";
import { saveMyPharmacyProfile } from "@/app/actions/pharmacy-orders";
import { Button, Card, Input } from "@/components/ui";
import { deliveryQuote } from "@/lib/pharmacy/delivery";

type Profile = {
  acceptsOrders: boolean; address: string; city: string; phone: string; latitude: number | null; longitude: number | null;
  opensAt: string; closesAt: string; deliveryEnabled: boolean; deliveryBaseFee: number; deliveryPerKm: number; deliveryMaxKm: number | null;
};

const EMPTY: Profile = { acceptsOrders: false, address: "", city: "", phone: "", latitude: null, longitude: null, opensAt: "", closesAt: "", deliveryEnabled: false, deliveryBaseFee: 0, deliveryPerKm: 0, deliveryMaxKm: null };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600" />
      <span><span className="block text-sm font-black">{label}</span><span className="block text-xs text-slate-500">{description}</span></span>
    </label>
  );
}

export function MyPharmacyForm({ facilityName, initial }: { facilityName: string; initial: Profile | null }) {
  const [form, setForm] = useState<Profile>(initial ?? EMPTY);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, startSave] = useTransition();
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setForm((current) => ({ ...current, [key]: value }));
  const num = (value: string) => (value === "" ? 0 : Number(value));

  const locate = () => {
    if (!navigator.geolocation) { setMessage({ ok: false, text: "المتصفح لا يدعم تحديد الموقع" }); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocating(false); setForm((current) => ({ ...current, latitude: Number(position.coords.latitude.toFixed(6)), longitude: Number(position.coords.longitude.toFixed(6)) })); },
      () => { setLocating(false); setMessage({ ok: false, text: "تعذر تحديد الموقع. اسمح للمتصفح بالوصول إلى الموقع، أو أدخل الإحداثيات يدويًا" }); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = () => {
    setMessage(null);
    startSave(async () => {
      const result = await saveMyPharmacyProfile(form);
      setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: "تم حفظ بيانات الصيدلية" });
    });
  };

  const example = deliveryQuote({ enabled: form.deliveryEnabled, baseFee: form.deliveryBaseFee, perKm: form.deliveryPerKm, maxKm: form.deliveryMaxKm }, 5);

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Card className="space-y-3 p-4">
        <h2 className="text-base font-black">{facilityName}</h2>
        <Toggle checked={form.acceptsOrders} onChange={(value) => set("acceptsOrders", value)} label="استقبال طلبات المستفيدين" description="عند التفعيل تظهر صيدليتك في بوابة المستفيدين ويمكنهم مراسلتك وطلب الأدوية." />
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-base font-black"><MapPin className="h-4 w-4 text-teal-600" /> الموقع والتواصل</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="المدينة"><Input value={form.city} onChange={(event) => set("city", event.target.value)} /></Field>
          <Field label="هاتف الصيدلية"><Input value={form.phone} dir="ltr" inputMode="tel" onChange={(event) => set("phone", event.target.value)} /></Field>
        </div>
        <Field label="العنوان"><Input value={form.address} onChange={(event) => set("address", event.target.value)} placeholder="الحي، الشارع، علامة مميزة" /></Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="خط العرض"><Input className="w-40" dir="ltr" inputMode="decimal" value={form.latitude ?? ""} onChange={(event) => set("latitude", event.target.value === "" ? null : Number(event.target.value))} /></Field>
          <Field label="خط الطول"><Input className="w-40" dir="ltr" inputMode="decimal" value={form.longitude ?? ""} onChange={(event) => set("longitude", event.target.value === "" ? null : Number(event.target.value))} /></Field>
          <Button type="button" variant="outline" onClick={locate} disabled={locating} className="h-10 text-sm">
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} استخدم موقعي الحالي
          </Button>
        </div>
        <p className="text-xs text-slate-500">افتح هذه الصفحة من داخل الصيدلية واضغط «استخدم موقعي الحالي» لأدق نتيجة.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="يفتح الساعة" hint="بتوقيت طرابلس، مثال 09:00"><Input type="time" dir="ltr" value={form.opensAt} onChange={(event) => set("opensAt", event.target.value)} /></Field>
          <Field label="يغلق الساعة" hint="يمكن أن يكون بعد منتصف الليل، مثال 02:00"><Input type="time" dir="ltr" value={form.closesAt} onChange={(event) => set("closesAt", event.target.value)} /></Field>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-base font-black">التوصيل</h2>
        <Toggle checked={form.deliveryEnabled} onChange={(value) => set("deliveryEnabled", value)} label="أوفر خدمة التوصيل" description="قيمة التوصيل خارج التأمين، تظهر للمستفيد قبل الطلب ويدفعها نقدًا عند الاستلام." />
        {form.deliveryEnabled && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="قيمة أساسية (د.ل)"><Input type="number" min="0" step="0.25" dir="ltr" inputMode="decimal" value={form.deliveryBaseFee} onChange={(event) => set("deliveryBaseFee", num(event.target.value))} /></Field>
              <Field label="لكل كيلومتر (د.ل)" hint="0 = قيمة ثابتة"><Input type="number" min="0" step="0.25" dir="ltr" inputMode="decimal" value={form.deliveryPerKm} onChange={(event) => set("deliveryPerKm", num(event.target.value))} /></Field>
              <Field label="أقصى مسافة (كم)" hint="فارغ = بلا حد"><Input type="number" min="0" step="0.5" dir="ltr" inputMode="decimal" value={form.deliveryMaxKm ?? ""} onChange={(event) => set("deliveryMaxKm", event.target.value === "" ? null : Number(event.target.value))} /></Field>
            </div>
            <p className="rounded-md bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
              مثال لمستفيد على بعد 5 كم: {example.available ? `${example.fee} د.ل` : example.reason}
            </p>
          </>
        )}
      </Card>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={`flex items-center gap-2 rounded-md p-3 text-sm font-bold ${message.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300"}`}>
          {message.ok && <CheckCircle2 className="h-4 w-4" />} {message.text}
        </p>
      )}
      <Button type="submit" disabled={saving} className="h-11 w-full text-sm">{saving && <Loader2 className="h-4 w-4 animate-spin" />} حفظ</Button>
    </form>
  );
}
