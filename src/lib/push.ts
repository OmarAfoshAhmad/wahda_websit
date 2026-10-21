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

/** يرسل لكل أجهزة المرفق المشتركة، ويحذف الاشتراكات المنتهية (410/404). لا يرمي أخطاء. */
export async function sendPushToFacility(facilityId: string, payload: PushPayload) {
  if (!configure()) return;
  try {
    const subscriptions = await prisma.facilityPushSubscription.findMany({ where: { facility_id: facilityId } });
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60, urgency: "high" },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await prisma.facilityPushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
        else logger.warn("push send failed", { status, facilityId });
      }
    }));
  } catch (error) {
    logger.warn("push lookup failed", { error: String(error) });
  }
}
