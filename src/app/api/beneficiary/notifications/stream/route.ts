import { NextRequest } from "next/server";
import { getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";
import { addSSEConnection, canAcceptSSEConnection, removeSSEConnection } from "@/lib/sse-notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) {
    return new Response("غير مصرح", { status: 401 });
  }

  const beneficiaryId = session.id;

  if (!canAcceptSSEConnection(beneficiaryId)) {
    return new Response("تم تجاوز الحد الأقصى للاتصالات اللحظية. حاول مجدداً بعد قليل.", {
      status: 429,
      headers: { "Retry-After": "10" },
    });
  }

  let controller: ReadableStreamDefaultController<Uint8Array>;

  let heartbeatTimer: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      const accepted = addSSEConnection(beneficiaryId, controller);
      if (!accepted) {
        ctrl.close();
        return;
      }

      const encoder = new TextEncoder();
      ctrl.enqueue(encoder.encode(`: connected\n\n`));

      // heartbeat كل 25 ثانية لمنع قطع الاتصال من reverse proxy
      heartbeatTimer = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(`: ping\n\n`));
        } catch (error) {
          console.error("[api/beneficiary/notifications/stream] Heartbeat failed", error);
          clearInterval(heartbeatTimer);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeatTimer);
      removeSSEConnection(beneficiaryId, controller);
    },
  });

  req.signal.addEventListener("abort", () => {
    clearInterval(heartbeatTimer);
    removeSSEConnection(beneficiaryId, controller);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
