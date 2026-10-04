"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, CheckCheck, FileText, ImagePlus, Loader2, Send, X } from "lucide-react";
import { ACCEPTED_FILES, prepareFile } from "@/lib/pharmacy/client-files";

export type ChatMessage = {
  id: string;
  sender: "BENEFICIARY" | "FACILITY";
  body: string | null;
  attachment_kind: "INSURANCE_CARD" | "PRESCRIPTION" | null;
  file_name: string | null;
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
  const [kind, setKind] = useState<"PRESCRIPTION" | "INSURANCE_CARD">("PRESCRIPTION");
  const [error, setError] = useState("");
  const [sending, startSend] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

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
        formData.set("kind", kind);
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
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${mine ? "rounded-ss-sm bg-teal-600 text-white" : "rounded-se-sm border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"}`}>
                  {message.attachment_kind && (
                    <a href={`/api/pharmacy/order-files/${message.id}`} target="_blank" rel="noopener noreferrer" className="mb-1 block">
                      {message.file_name?.endsWith(".pdf") ? (
                        <span className={`inline-flex items-center gap-1.5 font-bold underline ${mine ? "text-white" : "text-teal-700 dark:text-teal-300"}`}><FileText className="h-4 w-4" /> {message.file_name}</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- صورة محمية تُخدم من مسار مصادق، لا يناسبها next/image
                        <img src={`/api/pharmacy/order-files/${message.id}`} alt={message.attachment_kind === "INSURANCE_CARD" ? "صورة البطاقة التأمينية" : "صورة الوصفة"} className="max-h-56 rounded-lg" loading="lazy" />
                      )}
                      <span className={`mt-0.5 block text-xs ${mine ? "text-teal-100" : "text-slate-500"}`}>{message.attachment_kind === "INSURANCE_CARD" ? "البطاقة التأمينية" : "الوصفة"}</span>
                    </a>
                  )}
                  {message.body && <p className="whitespace-pre-wrap break-words" dir="auto">{message.body}</p>}
                  <span className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] ${mine ? "text-teal-100" : "text-slate-400"}`}>
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
              <label className="flex items-center gap-1 text-xs font-bold">
                <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-600 dark:bg-slate-900" aria-label="نوع الصورة">
                  <option value="PRESCRIPTION">وصفة</option>
                  <option value="INSURANCE_CARD">بطاقة تأمين</option>
                </select>
              </label>
              <button type="button" onClick={() => setFile(null)} aria-label="إزالة الملف" className="text-slate-500 hover:text-rose-600"><X className="h-4 w-4" /></button>
            </div>
          )}
          {error && <p role="alert" className="mb-1 text-xs font-bold text-rose-600">{error}</p>}
          <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <label className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-within:ring-2 focus-within:ring-teal-500 dark:hover:bg-slate-800" title="إرفاق صورة">
              <ImagePlus className="h-5 w-5" aria-hidden />
              <input type="file" accept={ACCEPTED_FILES} className="sr-only" aria-label="إرفاق صورة" onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) setFile(picked); }} />
            </label>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
              rows={1}
              maxLength={1000}
              placeholder="اكتب رسالة…"
              aria-label="نص الرسالة"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <button type="submit" disabled={sending || (!text.trim() && !file)} aria-label="إرسال" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white disabled:opacity-40">
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** يستمع لأحداث الطلبات والمحادثة لحظيًا، ويعيد الاتصال تلقائيًا عند الانقطاع (سلوك EventSource). */
export function useOrderEvents(url: string, onEvent: (event: OrderEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; });
  useEffect(() => {
    const source = new EventSource(url);
    source.onmessage = (message) => {
      try {
        handler.current(JSON.parse(message.data) as OrderEvent);
      } catch {
        // تجاهل أي حدث غير مفهوم
      }
    };
    return () => source.close();
  }, [url]);
}

export type OrderEvent =
  | { type: "message"; orderId: string; message: ChatMessage }
  | { type: "order"; orderId: string; status: string }
  | { type: "read"; orderId: string; reader: "BENEFICIARY" | "FACILITY" };

export const ORDER_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "بانتظار رد الصيدلية", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  AVAILABLE: { label: "متوفر — بانتظار تأكيدك", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" },
  CONFIRMED: { label: "مؤكد — قيد التجهيز", tone: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" },
  OUT_FOR_DELIVERY: { label: "خرج للتوصيل", tone: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300" },
  COMPLETED: { label: "تم التسليم", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
  REJECTED: { label: "اعتذرت الصيدلية", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300" },
  CANCELLED: { label: "ملغى", tone: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const meta = ORDER_STATUS_LABELS[status] ?? { label: status, tone: "bg-slate-100 text-slate-700" };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${meta.tone}`}>{meta.label}</span>;
}

