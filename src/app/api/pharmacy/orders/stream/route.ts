import { NextRequest } from "next/server";
import { hasPermission, requireActiveFacilitySession } from "@/lib/session-guard";
import { openOrderEventStream } from "@/lib/pharmacy/order-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** أحداث طلبات المستفيدين الواردة إلى حساب المرفق نفسه. */
export async function GET(req: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(session, "pharmacy_services")) return new Response("Forbidden", { status: 403 });
  return openOrderEventStream(`facility:${session.id}`, req.signal);
}
