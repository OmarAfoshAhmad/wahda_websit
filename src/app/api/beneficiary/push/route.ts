import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";
import { familyAccountIdOf } from "@/lib/beneficiary-family";
import { getPushPublicKey } from "@/lib/push";

export const runtime = "nodejs";

/** المفتاح العام لاشتراك الجهاز، أو null إن لم تُضبط مفاتيح الإشعارات في الخادم. */
export async function GET(req: NextRequest) {
  if (!(await getBeneficiarySessionFromRequest(req))) return NextResponse.json({ error: "انتهت الجلسة" }, { status: 401 });
  return NextResponse.json({ publicKey: getPushPublicKey() });
}

/** يسجل هذا الجهاز لإشعارات ردود الصيدلية على طلبات الأسرة. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "طلب غير مسموح" }, { status: 403 });
  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "انتهت الجلسة" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth || endpoint.length > 1000) {
    return NextResponse.json({ error: "اشتراك غير صالح" }, { status: 400 });
  }
  // الجهاز يرتبط بحساب الأسرة، فيصله رد الصيدلية على طلب أي فرد منها.
  const accountId = await familyAccountIdOf(session.account_id ?? session.id);
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;
  await prisma.beneficiaryPushSubscription.upsert({
    where: { endpoint },
    create: { account_id: accountId, endpoint, p256dh, auth, user_agent: userAgent },
    update: { account_id: accountId, p256dh, auth, user_agent: userAgent },
  });
  return NextResponse.json({ status: "ok" });
}

/** يلغي اشتراك هذا الجهاز (مثلًا عند تسجيل الخروج). */
export async function DELETE(req: NextRequest) {
  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "انتهت الجلسة" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const accountId = await familyAccountIdOf(session.account_id ?? session.id);
  await prisma.beneficiaryPushSubscription.deleteMany({ where: { endpoint, account_id: accountId } });
  return NextResponse.json({ status: "ok" });
}
