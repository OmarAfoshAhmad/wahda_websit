"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Check, CheckCheck, FileText, MapPin, ImagePlus, Loader2, Send, X } from "lucide-react";
import { ACCEPTED_FILES, prepareFile } from "@/lib/pharmacy/client-files";
import { CameraButton } from "@/components/pharmacy/camera-capture";
import { getCurrentLocation } from "@/lib/geo-client";

export type ChatMessage = {
  id: string;
  sender: "BENEFICIARY" | "FACILITY";
  body: string | null;
  attachment_kind: "INSURANCE_CARD" | "PRESCRIPTION" | null;
  file_name: string | null;
  location: { latitude: number; longitude: number } | null;
  read_at: string | null;
  created_at: string;
};

const timeOf = (value: string) => new Date(value).toLocaleTimeString("ar-LY", { timeZone: "Africa/Tripoli", hour: "2-digit", minute: "2-digit" });
const dayOf = (value: string) => new Date(value).toLocaleDateString("ar-LY", { timeZone: "Africa/Tripoli", day: "numeric", month: "long" });

/**
 * محادثة طلب صيدلية مشتركة بين المستفيد وحساب المرفق.
 * `viewer` يحدد أي الرسائل "مني" (تظهر في جهة البداية بلون مختلف).
 */
export function OrderChat({
  viewer,
  messages,
  closed,
  send,
}: {
  viewer: "BENEFICIARY" | "FACILITY";
  messages: ChatMessage[];
  closed: boolean;
  send: (formData: FormData) => Promise<{ error?: string } | undefined>;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [sending, startSend] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const [locating, setLocating] = useState(false);

  // المستفيد يرسل موقعه الحالي برسالة مستقلة تفتحها الصيدلية على الخرائط.
  const sendLocation = () => {
    setError("");
    setLocating(true);
    getCurrentLocation()
      .then((point) => {
        setLocating(false);
        startSend(async () => {
          const formData = new FormData();
          formData.set("body", "موقعي");
          formData.set("latitude", String(point.latitude));
          formData.set("longitude", String(point.longitude));
          const result = await send(formData);
          if (result?.error) setError(result.error);
        });
      })
      .catch((reason: Error) => { setLocating(false); setError(reason.message); });
  };


  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  // المستفيد: اختيار الصورة يرسلها مباشرة بنوعها، بلا خطوة اختيار نوع ولا ضغط إرسال إضافي.
  // صورة أو ملف عام في المحادثة؛ البطاقة والوصفة أُرسلتا مع الطلب نفسه.
  const sendPhoto = (picked: File) => {
    setError("");
    startSend(async () => {
      const prepared = await prepareFile(picked);
      if ("error" in prepared) { setError("لم نستطع قراءة هذه الصورة. حاول مرة أخرى"); return; }
      const formData = new FormData();
      formData.set("body", "");
      formData.set("file", prepared.file);
      const result = await send(formData);
      if (result?.error) setError(result.error);
    });
  };

  const submit = () => {
    if (!text.trim() && !file) return;
    setError("");
    startSend(async () => {
      const formData = new FormData();
      formData.set("body", text.trim());
      if (file) {
        const prepared = await prepareFile(file);
        if ("error" in prepared) { setError(prepared.error); return; }
        formData.set("file", prepared.file);
      }
      const result = await send(formData);
      if (result?.error) { setError(result.error); return; }
      setText("");
      setFile(null);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite" aria-label="المحادثة">
        {messages.map((message, index) => {
          const mine = message.sender === viewer;
          const showDay = index === 0 || dayOf(messages[index - 1].created_at) !== dayOf(message.created_at);
          return (
            <li key={message.id}>
              {showDay && <p className="my-2 text-center text-xs font-bold text-slate-400">{dayOf(message.created_at)}</p>}
              <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-base shadow-sm ${mine ? "rounded-ss-sm bg-teal-600 text-white" : "rounded-se-sm border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"}`}>
                  {message.file_name && (
                    <a href={`/api/pharmacy/order-files/${message.id}`} target="_blank" rel="noopener noreferrer" className="mb-1 block">
                      {message.file_name?.endsWith(".pdf") ? (
                        <span className={`inline-flex items-center gap-1.5 font-bold underline ${mine ? "text-white" : "text-primary dark:text-teal-300"}`}><FileText className="h-4 w-4" /> {message.file_name}</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- صورة محمية تُخدم من مسار مصادق، لا يناسبها next/image
                        <img src={`/api/pharmacy/order-files/${message.id}`} alt={message.attachment_kind === "INSURANCE_CARD" ? "صورة البطاقة التأمينية" : message.attachment_kind === "PRESCRIPTION" ? "صورة الوصفة" : "مرفق"} className="max-h-56 rounded-lg" loading="lazy" />
                      )}
                      <span className={`mt-0.5 block text-xs ${mine ? "text-teal-50" : "text-slate-500"}`}>{message.attachment_kind === "INSURANCE_CARD" ? "البطاقة التأمينية" : message.attachment_kind === "PRESCRIPTION" ? "الوصفة" : "مرفق"}</span>
                    </a>
                  )}
                  {message.location ? (
                    <a href={`https://www.google.com/maps?q=${message.location.latitude},${message.location.longitude}`} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-2 rounded-xl px-2 py-1.5 font-bold underline-offset-2 hover:underline ${mine ? "bg-teal-700/40" : "bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"}`}>
                      <MapPin className="h-5 w-5 shrink-0" aria-hidden />
                      <span>
                        <span className="block">الموقع</span>
                        <span className="block text-xs font-normal opacity-80">فتح في الخرائط</span>
                      </span>
                    </a>
                  ) : message.body && <p className="whitespace-pre-wrap break-words" dir="auto">{message.body}</p>}
                  <span className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] ${mine ? "text-teal-50" : "text-slate-400"}`}>
                    {timeOf(message.created_at)}
                    {mine && (message.read_at ? <CheckCheck className="h-3.5 w-3.5" aria-label="مقروءة" /> : <Check className="h-3.5 w-3.5" aria-label="مرسلة" />)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>

      {closed ? (
        <p className="border-t border-slate-200 p-3 text-center text-sm font-bold text-slate-500 dark:border-slate-700">الطلب مغلق، لا يمكن إرسال رسائل جديدة.</p>
      ) : (
        <div className="border-t border-slate-200 p-2 dark:border-slate-700">
          {file && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-100 px-2 py-1.5 text-sm dark:bg-slate-800">
              <span className="min-w-0 flex-1 truncate font-bold">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} aria-label="إزالة الملف" className="text-slate-500 hover:text-rose-600"><X className="h-4 w-4" /></button>
            </div>
          )}
          {error && <p role="alert" className={`mb-2 font-bold text-rose-600 ${viewer === "BENEFICIARY" ? "text-base" : "text-xs"}`}>{error}</p>}
          {viewer === "BENEFICIARY" && (
            <div className="mb-2 grid grid-cols-3 gap-2">
              <CameraButton label="تصوير" disabled={sending} onCapture={sendPhoto} className="flex h-14 flex-col items-center justify-center rounded-2xl bg-teal-50 text-sm font-bold text-teal-800 focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50 dark:bg-slate-800 dark:text-teal-200">
                <Camera className="h-5 w-5" aria-hidden />
                تصوير
              </CameraButton>
              <label className={`flex h-14 cursor-pointer flex-col items-center justify-center rounded-2xl bg-teal-50 text-sm font-bold text-teal-800 focus-within:ring-2 focus-within:ring-teal-500 dark:bg-slate-800 dark:text-teal-200 ${sending ? "pointer-events-none opacity-50" : ""}`}>
                <ImagePlus className="h-5 w-5" aria-hidden />
                إرفاق ملف
                <input type="file" accept={ACCEPTED_FILES} className="sr-only" aria-label="إرفاق ملف" disabled={sending} onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) sendPhoto(picked); }} />
              </label>
              <button type="button" onClick={sendLocation} disabled={locating || sending} className="flex h-14 flex-col items-center justify-center rounded-2xl bg-teal-50 text-sm font-bold text-teal-800 disabled:opacity-50 dark:bg-slate-800 dark:text-teal-200">
                {locating ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <MapPin className="h-5 w-5" aria-hidden />}
                موقعي
              </button>
            </div>
          )}
          <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            {viewer === "FACILITY" && (
              <label className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-within:ring-2 focus-within:ring-teal-500 dark:hover:bg-slate-800" title="إرفاق صورة">
                <ImagePlus className="h-5 w-5" aria-hidden />
                <input type="file" accept={ACCEPTED_FILES} className="sr-only" aria-label="إرفاق صورة" onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) setFile(picked); }} />
              </label>
            )}
            {viewer === "FACILITY" && (
              <CameraButton onCapture={setFile} label="" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" />
            )}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
              rows={1}
              maxLength={1000}
              placeholder="اكتب رسالة…"
              aria-label="نص الرسالة"
              className={`max-h-28 flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 ${viewer === "BENEFICIARY" ? "min-h-12 text-base" : "min-h-10 text-sm"}`}
            />
            <button type="submit" disabled={sending || (!text.trim() && !file)} aria-label="إرسال" className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-teal-600 font-bold text-white hover:bg-teal-700 disabled:opacity-40 ${viewer === "BENEFICIARY" ? "h-12 px-4 text-base" : "h-10 w-10"}`}>
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
              {viewer === "BENEFICIARY" && !sending && "إرسال"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** يستمع لأحداث الطلبات والمحادثة لحظيًا، ويعيد الاتصال تلقائيًا عند الانقطاع (سلوك EventSource). */
/**
 * onResync: يُستدعى عند عودة الاتصال بعد انقطاع وعند الرجوع إلى الصفحة؛ الجوال (خصوصًا الآيفون) يقطع الاتصال
 * عند قفل الشاشة، والأحداث أثناء الانقطاع تضيع، فيجب جلب الحالة من جديد.
 */
export function useOrderEvents(url: string, onEvent: (event: OrderEvent) => void, onStatus?: (status: "live" | "retrying") => void, onResync?: () => void) {
  const handler = useRef(onEvent);
  const status = useRef(onStatus);
  const resync = useRef(onResync);
  useEffect(() => { handler.current = onEvent; status.current = onStatus; resync.current = onResync; });
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") resync.current?.(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("pageshow", onVisible); };
  }, []);
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 2000;
    let closed = false;
    let opened = false;
    // EventSource يعيد الاتصال وحده بعد الانقطاع، لكنه يتوقف نهائيًا إن رفض الخادم (429/500):
    // نعيد فتحه يدويًا بمهلة متزايدة حتى لا تتوقف التنبيهات بصمت.
    const connect = () => {
      if (closed) return;
      source = new EventSource(url);
      source.onopen = () => {
        delay = 2000;
        status.current?.("live");
        if (opened) resync.current?.();
        opened = true;
      };
      source.onmessage = (message) => {
        try {
          handler.current(JSON.parse(message.data) as OrderEvent);
        } catch {
          // تجاهل أي حدث غير مفهوم
        }
      };
      source.onerror = () => {
        status.current?.("retrying");
        if (source?.readyState !== EventSource.CLOSED) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 60_000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); source?.close(); };
  }, [url]);
}

export type OrderEvent =
  | { type: "message"; orderId: string; message: ChatMessage }
  | { type: "order"; orderId: string; status: string }
  | { type: "read"; orderId: string; reader: "BENEFICIARY" | "FACILITY" };

export const ORDER_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "بانتظار رد الصيدلية", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  AVAILABLE: { label: "متوفر — بانتظار تأكيدك", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" },
  CONFIRMED: { label: "مؤكد — قيد التجهيز", tone: "bg-primary-light text-primary-dark dark:bg-primary/20 dark:text-teal-300" },
  OUT_FOR_DELIVERY: { label: "خرج للتوصيل", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300" },
  COMPLETED: { label: "تم التسليم", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
  REJECTED: { label: "اعتذرت الصيدلية", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300" },
  CANCELLED: { label: "ملغى", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const meta = ORDER_STATUS_LABELS[status] ?? { label: status, tone: "bg-slate-100 text-slate-700" };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${meta.tone}`}>{meta.label}</span>;
}

