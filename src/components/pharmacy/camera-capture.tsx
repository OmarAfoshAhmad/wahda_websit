"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, X } from "lucide-react";

/**
 * التقاط صورة بالكاميرا مباشرة على الكمبيوتر (كاميرا الويب) والجوال (الكاميرا الخلفية).
 * يفتح نافذة معاينة حية ثم «التقاط»؛ وإن لم تتوفر واجهة الكاميرا في المتصفح يفتح كاميرا الجوال الأصلية.
 * يحتاج اتصالًا آمنًا (https أو localhost).
 */
export function CameraButton({ label = "تصوير", disabled, onCapture, className, children }: { label?: string; disabled?: boolean; onCapture: (file: File) => void; className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const fallback = useRef<HTMLInputElement>(null);

  const start = () => {
    if (typeof navigator.mediaDevices?.getUserMedia === "function" && window.isSecureContext) setOpen(true);
    else fallback.current?.click();
  };

  return (
    <>
      <button type="button" onClick={start} disabled={disabled} aria-label={label || "تصوير بالكاميرا"} title="تصوير بالكاميرا" className={className ?? "inline-flex items-center gap-1 rounded-md border border-teal-300 px-2.5 py-1.5 text-xs font-black text-teal-700 hover:bg-teal-50 disabled:opacity-40 dark:border-teal-800 dark:text-teal-300"}>
        {children ?? <><Camera className={label ? "h-3.5 w-3.5" : "h-5 w-5"} aria-hidden />{label && <> {label}</>}</>}
      </button>
      <input ref={fallback} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onCapture(file); }} />
      {open && <CameraDialog onClose={() => setOpen(false)} onCapture={(file) => { setOpen(false); onCapture(file); }} onUnavailable={() => { setOpen(false); fallback.current?.click(); }} />}
    </>
  );
}

function CameraDialog({ onClose, onCapture, onUnavailable }: { onClose: () => void; onCapture: (file: File) => void; onUnavailable: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [shooting, setShooting] = useState(false);
  // مرجع ثابت حتى لا يُعاد تشغيل الكاميرا مع كل إعادة رسم للأب.
  const unavailable = useRef(onUnavailable);
  useEffect(() => { unavailable.current = onUnavailable; });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReady(false);
      stream.current?.getTracks().forEach((track) => track.stop());
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (cancelled) { media.getTracks().forEach((track) => track.stop()); return; }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (cause) {
        const name = (cause as DOMException)?.name;
        if (name === "NotFoundError" || name === "OverconstrainedError") unavailable.current();
        else setError(name === "NotAllowedError" ? "الكاميرا مرفوضة: اسمح للموقع باستخدامها من إعدادات المتصفح" : "تعذر تشغيل الكاميرا");
      }
    })();
    return () => { cancelled = true; };
  }, [facing]);

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);

  const capture = () => {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    setShooting(true);
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")?.drawImage(element, 0, 0);
    canvas.toBlob((blob) => {
      setShooting(false);
      if (!blob) { setError("تعذر حفظ الصورة"); return; }
      onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="الكاميرا" className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between p-3 text-white">
        <button type="button" onClick={onClose} aria-label="إغلاق الكاميرا" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"><X className="h-6 w-6" /></button>
        <p className="font-bold">ضع الورقة كاملة داخل الإطار</p>
        <button type="button" onClick={() => setFacing((value) => value === "environment" ? "user" : "environment")} aria-label="تبديل الكاميرا" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10"><RefreshCw className="h-5 w-5" /></button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={video} playsInline muted className="max-h-full max-w-full object-contain" />
        {!ready && !error && <Loader2 className="absolute h-10 w-10 animate-spin text-white" />}
        {error && <p role="alert" className="absolute mx-6 rounded-xl bg-white p-4 text-center font-bold text-rose-700">{error}</p>}
      </div>
      <div className="flex justify-center p-5">
        <button type="button" onClick={capture} disabled={!ready || shooting} aria-label="التقاط الصورة" className="h-18 w-18 rounded-full border-4 border-white bg-white/30 disabled:opacity-40" />
      </div>
    </div>
  );
}
