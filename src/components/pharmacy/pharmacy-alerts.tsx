"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, X } from "lucide-react";
import { useOrderEvents } from "@/components/pharmacy/order-chat";
import { armAlertToneOnFirstGesture, playAlertTone, unlockAlertTone } from "@/lib/alert-tone";

type Alert = { orderId: string; title: string; body: string };


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
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [push, setPush] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live" | "retrying">("connecting");

  // المتصفح لا يسمح بالصوت قبل أول لمسة/نقرة: نجهّز الصوت عندها.
  useEffect(() => armAlertToneOnFirstGesture(), []);

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
    playAlertTone();
    navigator.vibrate?.([200, 100, 200]);
    if (document.visibilityState !== "visible") setUnseen((count) => count + 1);
    // في صندوق الطلبات تكفي الصوت والتحديث المباشر؛ في غيره تظهر بطاقة تنبيه.
    if (!pathname?.startsWith("/admin/pharmacy-services/orders")) setAlerts((current) => [alert!, ...current.filter((item) => item.orderId !== alert!.orderId)].slice(0, 3));
  }, setConnection);

  const [soundOk, setSoundOk] = useState(false);
  const testSound = () => {
    const context = unlockAlertTone();
    playAlertTone();
    setSoundOk(Boolean(context));
  };

  const enablePush = async () => {
    setBusy(true);
    try {
      unlockAlertTone();
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

      {/* حالة اتصال التنبيهات المباشرة: تكشف فورًا إن كانت الطلبات لن تصل لهذا التبويب. */}
      <div className="fixed bottom-3 left-3 z-40 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-bold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300" role="status" aria-label="حالة تنبيهات الطلبات">
        <span className={`h-2 w-2 rounded-full ${connection === "live" ? "bg-emerald-500" : connection === "retrying" ? "animate-pulse bg-amber-500" : "bg-slate-400"}`} aria-hidden />
        <span className="hidden sm:inline">{connection === "live" ? "تنبيهات الطلبات متصلة" : connection === "retrying" ? "إعادة الاتصال بالتنبيهات…" : "جارٍ الاتصال بالتنبيهات…"}</span>
        <button type="button" onClick={testSound} className="ms-1 rounded-full bg-teal-600 px-2 py-0.5 text-white hover:bg-teal-700">
          {soundOk ? "الصوت ✓" : "تفعيل الصوت"}
        </button>
      </div>

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
