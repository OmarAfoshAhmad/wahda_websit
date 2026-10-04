/**
 * أحداث طلبات الصيدلية والمحادثة لحظيًا عبر SSE داخل نفس العملية (المنظومة تعمل على خادم واحد).
 * القنوات: "beneficiary:<id>" و"facility:<id>". كل حدث يُرسل لطرفي الطلب.
 */
type Controller = ReadableStreamDefaultController<Uint8Array>;

const MAX_PER_CHANNEL = 5;
const MAX_TOTAL = 1000;

declare global {
  var _pharmacyOrderChannels: Map<string, Set<Controller>> | undefined;
}
const channels: Map<string, Set<Controller>> = globalThis._pharmacyOrderChannels ?? (globalThis._pharmacyOrderChannels = new Map());
const encoder = new TextEncoder();

export type OrderEvent =
  | { type: "message"; orderId: string; message: { id: string; sender: "BENEFICIARY" | "FACILITY"; body: string | null; attachment_kind: string | null; file_name: string | null; created_at: string } }
  | { type: "order"; orderId: string; status: string }
  | { type: "read"; orderId: string; reader: "BENEFICIARY" | "FACILITY" };

export function publishOrderEvent(target: { beneficiaryId: string; facilityId: string }, event: OrderEvent) {
  const bytes = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const key of [`beneficiary:${target.beneficiaryId}`, `facility:${target.facilityId}`]) {
    const set = channels.get(key);
    if (!set) continue;
    for (const controller of [...set]) {
      try {
        controller.enqueue(bytes);
      } catch {
        set.delete(controller);
      }
    }
    if (set.size === 0) channels.delete(key);
  }
}

/** ينشئ استجابة SSE مشتركة لقناة واحدة، مع نبضة كل 25 ثانية وتنظيف عند الانقطاع. */
export function openOrderEventStream(channel: string, signal: AbortSignal) {
  let total = 0;
  for (const set of channels.values()) total += set.size;
  if (total >= MAX_TOTAL || (channels.get(channel)?.size ?? 0) >= MAX_PER_CHANNEL) {
    return new Response("تم تجاوز الحد الأقصى للاتصالات اللحظية", { status: 429, headers: { "Retry-After": "10" } });
  }

  let controller: Controller;
  let heartbeat: ReturnType<typeof setInterval>;
  const cleanup = () => {
    clearInterval(heartbeat);
    const set = channels.get(channel);
    set?.delete(controller);
    if (set && set.size === 0) channels.delete(channel);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      if (!channels.has(channel)) channels.set(channel, new Set());
      channels.get(channel)!.add(ctrl);
      ctrl.enqueue(encoder.encode(": connected\n\n"));
      heartbeat = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25_000);
    },
    cancel: cleanup,
  });
  signal.addEventListener("abort", cleanup);
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
