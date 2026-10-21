"use client";

import { useEffect, useState } from "react";
import { BellRing, Share, SquarePlus, X } from "lucide-react";

type State = "hidden" | "ios-install" | "ask" | "denied";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * يدعو المستفيد لتفعيل إشعارات الجوال: تصله ردود الصيدلية وتغيّر حالة الطلب والبوابة مغلقة.
 * على الآيفون لا تعمل الإشعارات إلا بعد إضافة البوابة إلى الشاشة الرئيسية وفتحها من الأيقونة، فيُعرض شرح ذلك.
 */
export function BeneficiaryPushPrompt() {
  const [state, setState] = useState<State>("hidden");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem("ben-push-dismissed") === "1") return;
      } catch {
        // التخزين المحلي غير متاح
      }
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        if (!cancelled && isIos() && !isStandalone()) setState("ios-install");
        return;
      }
      if (Notification.permission === "denied") { if (!cancelled) setState("denied"); return; }
      const registration = await navigator.serviceWorker.getRegistration("/pharmacy-sw.js").catch(() => undefined);
      const subscription = await registration?.pushManager.getSubscription().catch(() => null);
      if (!cancelled) setState(subscription ? "hidden" : "ask");
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem("ben-push-dismissed", "1"); } catch { /* غير متاح */ }
    setState("hidden");
  };

  const enable = async () => {
    setBusy(true);
    setMessage("");
    try {
      const { publicKey } = await fetch("/api/beneficiary/push").then((res) => res.json());
      if (!publicKey) { setMessage("الإشعارات غير مهيأة بعد. ستصلك الردود والصفحة مفتوحة."); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "ask"); return; }
      const registration = await navigator.serviceWorker.register("/pharmacy-sw.js");
      await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription())
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const res = await fetch("/api/beneficiary/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
      if (res.ok) setState("hidden");
      else setMessage("تعذر تفعيل الإشعارات. حاول مرة أخرى");
    } catch {
      setMessage("تعذر تفعيل الإشعارات. حاول مرة أخرى");
    } finally {
      setBusy(false);
    }
  };

  if (state === "hidden") return null;

  return (
    <section aria-label="إشعارات الجوال" className="relative mt-4 rounded-2xl border border-primary/30 bg-white p-4 shadow-sm dark:bg-slate-900">
      <button type="button" onClick={dismiss} aria-label="إخفاء" className="absolute left-3 top-3 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
      <p className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-white">
        <BellRing className="h-6 w-6 text-primary" aria-hidden /> لتصلك ردود الصيدلية بصوت
      </p>

      {state === "ios-install" && (
        <>
          <p className="mt-1 text-base text-slate-600 dark:text-slate-300">على الآيفون أضف البوابة إلى الشاشة الرئيسية أولًا:</p>
          <ol className="mt-3 space-y-2 text-base text-slate-800 dark:text-slate-200">
            <li className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light font-black text-primary">1</span> اضغط زر المشاركة <Share className="h-5 w-5 text-sky-600" aria-label="مشاركة" /> في Safari أو Chrome</li>
            <li className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light font-black text-primary">2</span> اختر «إضافة إلى الشاشة الرئيسية» <SquarePlus className="h-5 w-5" aria-hidden /></li>
            <li className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-light font-black text-primary">3</span> افتح البوابة من الأيقونة الجديدة، ثم اضغط «فعّل الإشعارات»</li>
          </ol>
          <p className="mt-2 text-sm text-slate-500">يحتاج iOS 16.4 أو أحدث.</p>
        </>
      )}

      {state === "ask" && (
        <>
          <p className="mt-1 text-base text-slate-600 dark:text-slate-300">يصلك إشعار عند رد الصيدلية أو تجهيز طلبك، حتى والبوابة مغلقة.</p>
          <button type="button" onClick={() => void enable()} disabled={busy} className="mt-3 h-14 w-full rounded-xl bg-primary text-lg font-black text-white disabled:opacity-60">
            {busy ? "جارٍ التفعيل…" : "فعّل الإشعارات"}
          </button>
        </>
      )}

      {state === "denied" && (
        <p className="mt-1 text-base text-slate-600 dark:text-slate-300">الإشعارات محجوبة لهذا الموقع. اسمح بها من إعدادات المتصفح أو الجوال لتصلك ردود الصيدلية.</p>
      )}
      {message && <p role="alert" className="mt-2 text-sm font-bold text-rose-700">{message}</p>}
    </section>
  );
}
