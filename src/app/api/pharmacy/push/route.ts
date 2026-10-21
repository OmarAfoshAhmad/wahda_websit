import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasPermission, requireActiveFacilitySession } from "@/lib/session-guard";
import { getPushPublicKey } from "@/lib/push";

export const runtime = "nodejs";

async function requirePharmacy() {
  const session = await requireActiveFacilitySession();
  return session && hasPermission(session, "pharmacy_services") ? session : null;
}

/** المفتاح العام لاشتراك الجهاز، أو null إن لم تُضبط مفاتيح الإشعارات في الخادم. */
export async function GET() {
  if (!(await requirePharmacy())) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  return NextResponse.json({ publicKey: getPushPublicKey() });
}

/** يسجل اشتراك هذا الجهاز لإشعارات طلبات الصيدلية. */
export async function POST(req: NextRequest) {
  const session = await requirePharmacy();
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth || endpoint.length > 1000) {
    return NextResponse.json({ error: "اشتراك غير صالح" }, { status: 400 });
  }
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  await prisma.facilityPushSubscription.upsert({
    where: { endpoint },
    create: { facility_id: session.id, endpoint, p256dh, auth, user_agent: userAgent },
    update: { facility_id: session.id, p256dh, auth, user_agent: userAgent },
  });
  return NextResponse.json({ status: "ok" });
}

/** يلغي اشتراك هذا الجهاز. */
export async function DELETE(req: NextRequest) {
  const session = await requirePharmacy();
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  await prisma.facilityPushSubscription.deleteMany({ where: { endpoint, facility_id: session.id } });
  return NextResponse.json({ status: "ok" });
}
