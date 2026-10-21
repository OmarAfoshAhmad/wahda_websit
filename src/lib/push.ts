import webpush from "web-push";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * إشعارات الويب (Web Push) لأجهزة الصيدلية: تصل والمنظومة مغلقة، بصوت إشعارات الجهاز.
 * تحتاج VAPID_PUBLIC_KEY وVAPID_PRIVATE_KEY في البيئة؛ بدونها تُتجاهل الإشعارات بصمت (التنبيه داخل الصفحة يبقى).
 * توليد المفاتيح مرة واحدة: npx web-push generate-vapid-keys
 */
let configured: boolean | null = null;

function configure() {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  configured = Boolean(publicKey && privateKey);
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:support@waha.ly", publicKey!, privateKey!);
  return configured;
}

export function getPushPublicKey() {
  return configure() ? process.env.VAPID_PUBLIC_KEY! : null;
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };

/** يرسل لمجموعة اشتراكات ويعيد معرّفات المنتهية (410/404) لحذفها. لا يرمي أخطاء. */
async function deliver(subscriptions: StoredSubscription[], payload: PushPayload, context: Record<string, unknown>) {
  const expired: string[] = [];
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: "high" },
      );
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) expired.push(subscription.id);
      else logger.warn("push send failed", { status, ...context });
    }
  }));
  return expired;
}

/** يرسل لكل أجهزة المرفق المشتركة، ويحذف الاشتراكات المنتهية. */
export async function sendPushToFacility(facilityId: string, payload: PushPayload) {
  if (!configure()) return;
  try {
    const subscriptions = await prisma.facilityPushSubscription.findMany({ where: { facility_id: facilityId } });
    const expired = await deliver(subscriptions, payload, { facilityId });
    if (expired.length) await prisma.facilityPushSubscription.deleteMany({ where: { id: { in: expired } } });
  } catch (error) {
    logger.warn("push lookup failed", { error: String(error) });
  }
}

/** يرسل لأجهزة أسرة المستفيد (الأجهزة مرتبطة بحساب صاحب البطاقة). */
export async function sendPushToBeneficiary(beneficiaryId: string, payload: PushPayload) {
  if (!configure()) return;
  try {
    const { familyAccountIdOf } = await import("@/lib/beneficiary-family");
    const accountId = await familyAccountIdOf(beneficiaryId);
    const subscriptions = await prisma.beneficiaryPushSubscription.findMany({ where: { account_id: accountId } });
    const expired = await deliver(subscriptions, payload, { accountId });
    if (expired.length) await prisma.beneficiaryPushSubscription.deleteMany({ where: { id: { in: expired } } });
  } catch (error) {
    logger.warn("beneficiary push failed", { error: String(error) });
  }
}
