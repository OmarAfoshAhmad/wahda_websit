import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";

// تنظيف تلقائي للإشعارات المقروءة الأقدم من 90 يوم (مرة كل 6 ساعات)
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CLEANUP_AGE_DAYS = 90;
let lastCleanupAt = 0;

function maybeCleanupOldNotifications() {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  const cutoff = new Date(now - CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000);
  prisma.notification.deleteMany({
    where: { is_read: true, created_at: { lt: cutoff } },
  }).catch(() => { /* best effort */ });
}

// جلب آخر الإشعارات
export async function GET(req: NextRequest) {
  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  maybeCleanupOldNotifications();

  const notifications = await prisma.notification.findMany({
    where: { beneficiary_id: session.id },
    orderBy: { created_at: "desc" },
    take: 20,
    select: { id: true, title: true, message: true, amount: true, is_read: true, created_at: true },
  });

  return NextResponse.json(
    notifications.map((n) => ({ ...n, amount: n.amount ? Number(n.amount) : null }))
  );
}

// تحديد الكل كمقروء
export async function PATCH(req: NextRequest) {
  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  await prisma.notification.updateMany({
    where: { beneficiary_id: session.id, is_read: false },
    data: { is_read: true },
  });

  return NextResponse.json({ ok: true });
}
