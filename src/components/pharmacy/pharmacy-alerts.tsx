"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, X } from "lucide-react";
import { useOrderEvents } from "@/components/pharmacy/order-chat";

type Alert = { orderId: string; title: string; body: string };

/** نغمة تنبيه قصيرة (ثلاث نغمات) بلا ملف صوتي. المتصفح يسمح بها بعد أول تفاعل للمستخدم مع الصفحة. */
function playAlertTone(context: AudioContext | null) {
  if (!context) return;
  try {
    [0, 0.25, 0.5].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = index === 2 ? 1175 : 880;
      const start = context.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.22);
    });
  } catch {
    // جهاز لا يدعم الصوت البرمجي
  }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

type PushState = "unsupported" | "off" | "on" | "denied" | "unconfigured";

/**
 * تنبيهات طلبات المستفيدين لحساب الصيدلية في كل صفحات المنظومة: صوت واهتزاز وعدد في عنوان التبويب
 * عند طلب جديد أو رسالة من مستفيد، وزر لتفعيل إشعارات الجهاز (تصل والمنظومة مغلقة).
 */
export function PharmacyAlerts() {
  const router = useRouter();
  const pathname = usePathname();
  const audio = useRef<AudioContext | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [push, setPush] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);

  // المتصفح لا يسمح بالصوت قبل أول لمسة/نقرة: نجهّز الصوت عندها.
  useEffect(() => {
    const unlock = () => {
      if (audio.current) return;
      const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audio.current = new Ctor();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  // حالة إشعارات هذا الجهاز
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { if (!cancelled) setPush("unsupported"); return; }
      if (Notification.permission === "denied") { if (!cancelled) setPush("denied"); return; }
      const registration = await navigator.serviceWorker.getRegistration("/pharmacy-sw.js").catch(() => undefined);
      const subscription = await registration?.pushManager.getSubscription().catch(() => null);
      if (!cancelled) setPush(subscription ? "on" : "off");
    })();
    return () => { cancelled = true; };
  }, []);

  // عدد التنبيهات غير المرئية في عنوان التبويب
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unseen > 0 ? `(${unseen}) ${base}` : base;
  }, [unseen]);
  useEffect(() => {
    const clear = () => { if (document.visibilityState === "visible") setUnseen(0); };
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);

  useOrderEvents("/api/pharmacy/orders/stream", (event) => {
    let alert: Alert | null = null;
    if (event.type === "order" && event.status === "PENDING") alert = { orderId: event.orderId, title: "طلب دواء جديد", body: "وصل طلب جديد من مستفيد" };
    if (event.type === "message" && event.message.sender === "BENEFICIARY") {
      alert = { orderId: event.orderId, title: "رسالة من مستفيد", body: event.message.body?.slice(0, 80) || (event.message.attachment_kind ? "أرسل صورة" : event.message.location ? "أرسل موقعه" : "رسالة جديدة") };
    }
    if (!alert) return;
    playAlertTone(audio.current);
    navigator.vibrate?.([200, 100, 200]);
    if (document.visibilityState !== "visible") setUnseen((count) => count + 1);
    // في صندوق الطلبات تكفي الصوت والتحديث المباشر؛ في غيره تظهر بطاقة تنبيه.
    if (!pathname?.startsWith("/admin/pharmacy-services/orders")) setAlerts((current) => [alert!, ...current.filter((item) => item.orderId !== alert!.orderId)].slice(0, 3));
  });

  const enablePush = async () => {
    setBusy(true);
    try {
      if (!audio.current) {
        const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) audio.current = new Ctor();
      }
      const { publicKey } = await fetch("/api/pharmacy/push").then((res) => res.json());
      if (!publicKey) { setPush("unconfigured"); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setPush(permission === "denied" ? "denied" : "off"); return; }
      const registration = await navigator.serviceWorker.register("/pharmacy-sw.js");
      await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription())
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const res = await fetch("/api/pharmacy/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
      setPush(res.ok ? "on" : "off");
    } catch {
      setPush("off");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {(push === "off" || push === "denied" || push === "unconfigured") && (
        <div className="mx-auto mt-2 flex max-w-7xl flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="flex items-center gap-2 font-bold">
            <BellRing className="h-4 w-4 shrink-0" aria-hidden />
            {push === "denied" ? "الإشعارات محجوبة لهذا الموقع: اسمح بها من إعدادات المتصفح لتصلك الطلبات والجهاز مغلق."
              : push === "unconfigured" ? "إشعارات الجهاز غير مهيأة في الخادم بعد؛ ستصلك التنبيهات والصفحة مفتوحة فقط."
              : "فعّل الإشعارات على هذا الجهاز لتصلك طلبات المستفيدين بصوت حتى والمنظومة مغلقة."}
          </span>
          {push === "off" && (
            <button type="button" onClick={() => void enablePush()} disabled={busy} className="h-9 rounded-lg bg-amber-500 px-3 text-sm font-black text-white disabled:opacity-60">
              {busy ? "جارٍ التفعيل…" : "تفعيل الإشعارات"}
            </button>
          )}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md space-y-2" role="status" aria-live="assertive">
          {alerts.map((alert) => (
            <div key={alert.orderId} className="flex items-start gap-3 rounded-2xl border border-teal-200 bg-white p-3 shadow-lg dark:border-teal-900 dark:bg-slate-900">
              <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-black text-slate-900 dark:text-white">{alert.title}</p>
                <p className="truncate text-sm text-slate-600 dark:text-slate-300">{alert.body}</p>
                <Link
                  href={`/admin/pharmacy-services/orders?order=${alert.orderId}`}
                  onClick={() => { setAlerts((current) => current.filter((item) => item.orderId !== alert.orderId)); router.refresh(); }}
                  className="mt-1 inline-block text-sm font-black text-teal-700 hover:underline dark:text-teal-300"
                >
                  فتح الطلب
                </Link>
              </div>
              <button type="button" aria-label="إغلاق" onClick={() => setAlerts((current) => current.filter((item) => item.orderId !== alert.orderId))} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
