"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bike, Loader2, MapPin, Phone, Pill, Store } from "lucide-react";
import {
  getFacilityPharmacyOrder,
  listFacilityPharmacyOrders,
  sendFacilityOrderMessage,
  startDispenseFromOrder,
  updateFacilityPharmacyOrder,
} from "@/app/actions/pharmacy-orders";
import { Button, Card } from "@/components/ui";
import { OrderChat, OrderStatusBadge, useOrderEvents, type ChatMessage } from "@/components/pharmacy/order-chat";

const CATEGORY_LABELS: Record<string, string> = { ROUTINE: "روتيني", CHRONIC: "مزمن", CHEMICAL: "أورام" };
const CLOSED = ["COMPLETED", "REJECTED", "CANCELLED"];

type ListItem = Awaited<ReturnType<typeof listFacilityPharmacyOrders>>["items"][number];
type Thread = NonNullable<Extract<Awaited<ReturnType<typeof getFacilityPharmacyOrder>>, { order: unknown }>["order"]>;

const when = (value: string) => new Date(value).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function OrdersInbox() {
  const router = useRouter();
  const [filter, setFilter] = useState<"OPEN" | "CLOSED">("OPEN");
  const [items, setItems] = useState<ListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [acting, startAction] = useTransition();

  const loadList = useCallback(async () => {
    const result = await listFacilityPharmacyOrders(filter);
    setItems(result.items);
    setLoadingList(false);
  }, [filter]);

  const loadThread = useCallback(async (orderId: string) => {
    const result = await getFacilityPharmacyOrder(orderId);
    if ("order" in result && result.order) setThread(result.order);
    else setError(result.error ?? "تعذر تحميل الطلب");
  }, []);

  useEffect(() => {
    let cancelled = false;
    listFacilityPharmacyOrders(filter).then((result) => { if (!cancelled) { setItems(result.items); setLoadingList(false); } });
    return () => { cancelled = true; };
  }, [filter]);
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    getFacilityPharmacyOrder(activeId).then((result) => {
      if (cancelled) return;
      if ("order" in result && result.order) setThread(result.order);
      else setError(result.error ?? "تعذر تحميل الطلب");
    });
    return () => { cancelled = true; };
  }, [activeId]);

  useOrderEvents("/api/pharmacy/orders/stream", (event) => {
    void loadList();
    if (event.orderId !== activeId) return;
    if (event.type === "message") {
      setThread((current) => current && !current.messages.some((message) => message.id === event.message.id) ? { ...current, messages: [...current.messages, event.message] } : current);
      if (event.message.sender === "BENEFICIARY") void loadThread(event.orderId);
    } else if (event.type === "read") {
      setThread((current) => current && event.reader === "BENEFICIARY" ? { ...current, messages: current.messages.map((message) => message.sender === "FACILITY" ? { ...message, read_at: message.read_at ?? new Date().toISOString() } : message) } : current);
    } else {
      setThread((current) => current ? { ...current, status: event.status as Thread["status"] } : current);
    }
  });

  const act = (action: "AVAILABLE" | "REJECTED" | "OUT_FOR_DELIVERY" | "COMPLETED") => {
    if (!thread) return;
    let reason: string | undefined;
    if (action === "REJECTED") {
      const input = window.prompt("سبب الاعتذار (اختياري)، مثل: الدواء غير متوفر");
      if (input === null) return;
      reason = input;
    }
    setError("");
    startAction(async () => {
      const result = await updateFacilityPharmacyOrder(thread.id, action, reason);
      if ("error" in result && result.error) setError(result.error);
      await loadThread(thread.id);
      await loadList();
    });
  };

  const dispense = () => {
    if (!thread) return;
    setError("");
    startAction(async () => {
      const result = await startDispenseFromOrder(thread.id);
      if (!("companyId" in result) || !result.companyId) { setError(result.error ?? "تعذر بدء الصرف"); return; }
      router.push(`/admin/pharmacy-services/${result.companyId}?beneficiary=${result.beneficiaryId}&category=${result.category}&order=${thread.id}`);
    });
  };

  const closed = thread ? CLOSED.includes(thread.status) : true;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className={`p-2 ${activeId ? "hidden lg:block" : ""}`}>
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
          {(["OPEN", "CLOSED"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => { setFilter(value); setLoadingList(true); }} className={`rounded-md py-1.5 text-sm font-bold ${filter === value ? "bg-white shadow dark:bg-slate-900" : "text-slate-500"}`}>
              {value === "OPEN" ? "مفتوحة" : "منتهية"}
            </button>
          ))}
        </div>
        {loadingList ? (
          <p className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">{filter === "OPEN" ? "لا توجد طلبات مفتوحة. تأكد من تفعيل «استقبال الطلبات» في بيانات صيدليتك." : "لا توجد طلبات منتهية"}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setActiveId(item.id)} aria-current={activeId === item.id} className={`w-full rounded-lg border p-2.5 text-start ${activeId === item.id ? "border-teal-500 bg-teal-50 dark:bg-teal-950/30" : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-black">{item.beneficiaryName}</span>
                    {item.unread > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-xs font-black text-white">{item.unread}</span>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span>{CATEGORY_LABELS[item.category]}</span>·
                    <span className="inline-flex items-center gap-0.5">{item.fulfillment === "DELIVERY" ? <><Bike className="h-3 w-3" /> توصيل</> : <><Store className="h-3 w-3" /> استلام</>}</span>·
                    <span>{when(item.updatedAt)}</span>
                  </span>
                  <span className="mt-1 block"><OrderStatusBadge status={item.status} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className={`flex h-[calc(100vh-12rem)] min-h-[28rem] flex-col overflow-hidden ${activeId ? "" : "hidden lg:flex"}`}>
        {!thread || thread.id !== activeId ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">{activeId ? <Loader2 className="h-5 w-5 animate-spin" /> : "اختر طلبًا لعرض المحادثة"}</div>
        ) : (
          <>
            <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { setActiveId(null); setThread(null); }} className="lg:hidden" aria-label="رجوع للقائمة"><ArrowRight className="h-5 w-5" /></button>
                  <div>
                    <p className="text-base font-black">{thread.beneficiary?.name}</p>
                    <p className="text-xs text-slate-500" dir="ltr">{thread.beneficiary?.card_number}</p>
                  </div>
                </div>
                <OrderStatusBadge status={thread.status} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1"><Pill className="h-3.5 w-3.5" /> {CATEGORY_LABELS[thread.category]}</span>
                {thread.beneficiary?.phone_number && <a href={`tel:${thread.beneficiary.phone_number}`} className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300" dir="ltr"><Phone className="h-3.5 w-3.5" /> {thread.beneficiary.phone_number}</a>}
                {thread.fulfillment === "DELIVERY" ? (
                  <span className="inline-flex items-center gap-1">
                    <Bike className="h-3.5 w-3.5" /> توصيل {thread.deliveryFee} د.ل{thread.deliveryDistanceKm !== null ? ` · ${thread.deliveryDistanceKm} كم` : ""}
                    {thread.deliveryLocation && <a className="inline-flex items-center gap-0.5 text-teal-700 underline dark:text-teal-300" href={`https://www.google.com/maps?q=${thread.deliveryLocation.latitude},${thread.deliveryLocation.longitude}`} target="_blank" rel="noopener noreferrer"><MapPin className="h-3.5 w-3.5" /> الموقع</a>}
                  </span>
                ) : <span className="inline-flex items-center gap-1"><Store className="h-3.5 w-3.5" /> استلام من الصيدلية</span>}
              </div>
              {thread.chronicDrugs.length > 0 && (
                <p className="text-sm"><span className="font-bold">الأدوية المزمنة المطلوبة: </span>{thread.chronicDrugs.map((drug) => drug.name).join("، ")}</p>
              )}
              {!closed && (
                <div className="flex flex-wrap gap-2">
                  {thread.status === "PENDING" && <Button type="button" onClick={() => act("AVAILABLE")} disabled={acting} className="h-9 text-sm">متوفر</Button>}
                  {["AVAILABLE", "CONFIRMED", "OUT_FOR_DELIVERY"].includes(thread.status) && <Button type="button" onClick={dispense} disabled={acting} className="h-9 text-sm">{thread.prescriptionId ? "متابعة الصرف" : "بدء الصرف"}</Button>}
                  {thread.status === "CONFIRMED" && thread.fulfillment === "DELIVERY" && <Button type="button" variant="outline" onClick={() => act("OUT_FOR_DELIVERY")} disabled={acting} className="h-9 text-sm">خرج للتوصيل</Button>}
                  {["CONFIRMED", "OUT_FOR_DELIVERY"].includes(thread.status) && <Button type="button" variant="outline" onClick={() => act("COMPLETED")} disabled={acting} className="h-9 text-sm">تم التسليم</Button>}
                  {["PENDING", "AVAILABLE", "CONFIRMED"].includes(thread.status) && <Button type="button" variant="ghost" onClick={() => act("REJECTED")} disabled={acting} className="h-9 text-sm text-rose-700">اعتذار</Button>}
                  {acting && <Loader2 className="h-5 w-5 animate-spin self-center text-teal-600" />}
                </div>
              )}
              {error && <p role="alert" className="text-sm font-bold text-rose-600">{error}</p>}
            </div>
            <OrderChat
              viewer="FACILITY"
              messages={thread.messages as ChatMessage[]}
              closed={closed}
              send={async (formData) => {
                formData.set("orderId", thread.id);
                const result = await sendFacilityOrderMessage(formData);
                if ("message" in result && result.message) {
                  const message = result.message as ChatMessage;
                  setThread((current) => current && !current.messages.some((item) => item.id === message.id) ? { ...current, messages: [...current.messages, message] } : current);
                }
                return result.error ? { error: result.error } : undefined;
              }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
