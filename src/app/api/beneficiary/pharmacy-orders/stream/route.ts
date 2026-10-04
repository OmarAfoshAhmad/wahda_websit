import { NextRequest } from "next/server";
import { getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";
import { openOrderEventStream } from "@/lib/pharmacy/order-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** أحداث طلبات الصيدلية والمحادثة للمستفيد المسجل فقط. */
export async function GET(req: NextRequest) {
  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return new Response("غير مصرح", { status: 401 });
  return openOrderEventStream(`beneficiary:${session.id}`, req.signal);
}
