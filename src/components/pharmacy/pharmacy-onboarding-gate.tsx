"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2, MapPin, Phone, Store } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { getPharmacyOnboardingStatus, savePharmacyOnboarding } from "@/app/actions/pharmacy-orders";
import { subscribePharmacyPush } from "@/components/pharmacy/pharmacy-alerts";

type Status = Extract<Awaited<ReturnType<typeof getPharmacyOnboardingStatus>>, { needed: true }>;
type Spot = { latitude: number; longitude: number; accuracy: number };
const SKIP_KEY = "pharmacy-onboarding-location-later";

/**
 * عند دخول حساب صيدلية بلا هاتف أو بلا موقع: نافذة إلزامية تطلب رقم الهاتف، وتحدد الموقع تلقائيًا،
 * وتفعّل إشعارات الجهاز عند الحفظ. الهاتف إلزامي ولا تُغلق النافذة بدونه؛ الموقع يمكن تأجيله لهذه الجلسة فقط.
 */
export function PharmacyOnboardingGate() {
  const [status, setStatus] = useState<Status | null>(null);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [spot, setSpot] = useState<Spot | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const locate = useCallback(() => {
    if (!navigator.geolocation) { setLocationError("المتصفح لا يدعم تحديد الموقع"); return; }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => { setSpot({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: Math.round(position.coords.accuracy) }); setLocating(false); },
      (failure) => {
        setLocating(false);
        setLocationError(failure.code === failure.PERMISSION_DENIED ? "رُفض الوصول للموقع: اسمح به من إعدادات المتصفح ثم أعد المحاولة" : "تعذر تحديد الموقع، أعد المحاولة");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPharmacyOnboardingStatus().then((result) => {
      if (cancelled || !result.needed) return;
      let skipped = false;
      try { skipped = sessionStorage.getItem(SKIP_KEY) === "1"; } catch { /* تخزين غير متاح */ }
      if (result.hasPhone && skipped) return;
      setStatus(result);
      setPhone(result.phone);
      setAddress(result.address);
      if (!result.hasLocation) locate();
    });
    return () => { cancelled = true; };
  }, [locate]);

  if (!status) return null;

  const save = async () => {
    setError("");
    setSaving(true);
    // طلب إذن الإشعارات أولًا ضمن نقرة المستخدم (المتصفح يرفضه بعد انتظار الخادم).
    const pushing = subscribePharmacyPush();
    const result = await savePharmacyOnboarding({ phone, address, latitude: spot?.latitude ?? null, longitude: spot?.longitude ?? null });
    await pushing;
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    if (!spot && !status.hasLocation) {
      try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* تخزين غير متاح */ }
    }
    window.location.reload();
  };

  const needsLocation = !status.hasLocation;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="إكمال بيانات الصيدلية">
      <form className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-black"><Store className="h-5 w-5 text-teal-600" /> أكمل بيانات الصيدلية</h2>
          <p className="text-sm text-slate-500">يحتاجها المستفيدون للتواصل معك وطلب الأدوية، ولا يمكن المتابعة بدون رقم الهاتف.</p>
        </div>

        <label className="block space-y-1 text-sm font-bold">
          <span className="flex items-center gap-1"><Phone className="h-4 w-4" /> رقم هاتف الصيدلية <span className="text-rose-600">*</span></span>
          <Input autoFocus required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0912345678" inputMode="tel" dir="ltr" className="h-11" />
        </label>

        {needsLocation && (
          <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
            <p className="flex items-center gap-1 font-bold"><MapPin className="h-4 w-4" /> موقع الصيدلية</p>
            {locating && <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحديد الموقع تلقائيًا…</p>}
            {spot && <p className="font-bold text-emerald-700">✓ حُدد الموقع (بدقة ~{spot.accuracy} م). تأكد أنك داخل الصيدلية.</p>}
            {locationError && <p className="text-rose-700">{locationError}</p>}
            {!locating && <button type="button" onClick={locate} className="text-xs font-bold text-teal-700 underline">{spot ? "إعادة التحديد" : "حدد الموقع"}</button>}
            <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="العنوان (الحي، الشارع، معلم قريب)" className="h-10" />
          </div>
        )}

        <p className="flex items-start gap-1 text-xs text-slate-500"><BellRing className="mt-0.5 h-4 w-4 shrink-0" /> عند الحفظ تُفعَّل إشعارات هذا الجهاز لتصلك الطلبات بصوت حتى والمنظومة مغلقة؛ اختر «سماح» عندما يسألك المتصفح.</p>

        {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
        <Button type="submit" disabled={saving || phone.trim().length < 7 || locating} className="h-11 w-full bg-teal-600 text-white">
          {saving ? "جارٍ الحفظ…" : needsLocation && !spot ? "حفظ (تحديد الموقع لاحقًا)" : "حفظ ومتابعة"}
        </Button>
      </form>
    </div>
  );
}
