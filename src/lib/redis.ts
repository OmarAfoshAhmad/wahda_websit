/**
 * Redis Client Stub (Disabled)
 * ============================
 * تم تعطيل Redis بالكامل.
 * النظام الآن يعتمد على الذاكرة المحلية (In-Memory) للعمليات المؤقتة.
 */

export async function getRedisPublisherClient() {
  return null;
}

export async function getRedisSubscriberClient() {
  return null;
}

export function canUseRedis(): boolean {
  return false;
}
