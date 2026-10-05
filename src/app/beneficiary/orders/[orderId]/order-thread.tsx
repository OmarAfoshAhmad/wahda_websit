"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Bike, Loader2, Phone, Store } from "lucide-react";
import { getMyPharmacyOrder, sendBeneficiaryOrderMessage, updateMyPharmacyOrder } from "@/app/actions/pharmacy-orders";
import { OrderChat, OrderStatusBadge, useOrderEvents, type ChatMessage } from "@/components/pharmacy/order-chat";

type Thread = NonNullable<Extract<Awaited<ReturnType<typeof getMyPharmacyOrder>>, { order: unknown }>["order"]>;
const CATEGORY_LABELS: Record<string, string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدوية مزمنة", CHEMICAL: "أدوية الأورام" };
const CLOSED = ["COMPLETED", "REJECTED", "CANCELLED"];

export function BeneficiaryOrderThread({ initial }: { initial: Thread }) {
  const [thread, setThread] = useState(initial);
  const [error, setError] = useState("");
  const [acting, startAction] = useTransition();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const refresh = async () => {
    const result = await getMyPharmacyOrder(thread.id);
    if ("order" in result && result.order) setThread(result.order);
  };

  useOrderEvents("/api/beneficiary/pharmacy-orders/stream", (event) => {
    if (event.orderId !== thread.id) return;
    if (event.type === "message") {
      setThread((current) => current.messages.some((message) => message.id === event.message.id) ? current : { ...current, messages: [...current.messages, event.message] });
      if (event.message.sender === "FACILITY") void refresh();
      if (typeof navigator !== "undefined" && event.message.sender === "FACILITY") navigator.vibrate?.(80);
    } else if (event.type === "read" && event.reader === "FACILITY") {
      setThread((current) => ({ ...current, messages: current.messages.map((message) => message.sender === "BENEFICIARY" ? { ...message, read_at: message.read_at ?? new Date().toISOString() } : message) }));
    } else if (event.type === "order") {
      setThread((current) => ({ ...current, status: event.status as Thread["status"] }));
    }
  });

  const act = (action: "CONFIRM" | "CANCEL") => {
    setConfirmCancel(false);
    setError("");
    startAction(async () => {
      const result = await updateMyPharmacyOrder(thread.id, action);
      if ("error" in result && result.error) setError(result.error);
      await refresh();
    });
  };

  const closed = CLOSED.includes(thread.status);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <header className="space-y-2 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Link href="/beneficiary/pharmacy" aria-label="رجوع" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700"><ArrowRight className="h-5 w-5" /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-black">{thread.facility.name}</h1>
            <p className="text-xs text-slate-500">{CATEGORY_LABELS[thread.category]}</p>
          </div>
          {thread.facility.phone && <a href={`tel:${thread.facility.phone}`} aria-label="اتصال بالصيدلية" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-primary dark:border-slate-700"><Phone className="h-4 w-4" /></a>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <OrderStatusBadge status={thread.status} />
          {thread.fulfillment === "DELIVERY" ? <span className="inline-flex items-center gap-1"><Bike className="h-3.5 w-3.5" /> توصيل {thread.deliveryFee} د.ل خارج التأمين</span> : <span className="inline-flex items-center gap-1"><Store className="h-3.5 w-3.5" /> استلام من الصيدلية</span>}
        </div>
        {thread.chronicDrugs.length > 0 && <p className="text-xs"><span className="font-bold">المطلوب: </span>{thread.chronicDrugs.map((drug) => drug.name).join("، ")}</p>}
        {(thread.status === "AVAILABLE" || ["PENDING", "CONFIRMED"].includes(thread.status)) && (
          <div className="flex gap-2">
            {thread.status === "AVAILABLE" && (
              <button type="button" onClick={() => act("CONFIRM")} disabled={acting} className="flex h-10 flex-1 items-center justify-center gap-1 rounded-xl bg-primary text-sm font-black text-white disabled:opacity-50">
                {acting && <Loader2 className="h-4 w-4 animate-spin" />} تأكيد الطلب{thread.fulfillment === "DELIVERY" ? ` مع التوصيل (${thread.deliveryFee} د.ل)` : ""}
              </button>
            )}
            {confirmCancel ? (
              <>
                <button type="button" onClick={() => act("CANCEL")} disabled={acting} className="h-10 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white">تأكيد الإلغاء</button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="h-10 rounded-xl border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">رجوع</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmCancel(true)} disabled={acting} className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-bold text-rose-700 dark:border-slate-700">إلغاء</button>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-xs font-bold text-rose-600">{error}</p>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <OrderChat
          viewer="BENEFICIARY"
          messages={thread.messages as ChatMessage[]}
          closed={closed}
          send={async (formData) => {
            formData.set("orderId", thread.id);
            const result = await sendBeneficiaryOrderMessage(formData);
            if ("message" in result && result.message) {
              const message = result.message as ChatMessage;
              setThread((current) => current.messages.some((item) => item.id === message.id) ? current : { ...current, messages: [...current.messages, message] });
            }
            return "error" in result && result.error ? { error: result.error } : undefined;
          }}
        />
      </div>
    </div>
  );
}
