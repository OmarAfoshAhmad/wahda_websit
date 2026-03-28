/**
 * Redis-backed rate limiter مع fallback داخل الذاكرة.
 * يضمن حد موحد عبر جميع instances عند توفر Redis.
 */

import { getRedisPublisherClient } from "@/lib/redis";

interface Bucket {
  count: number;
  resetAt: number; // timestamp ms
}

// Map<key, Bucket> — لا تحتاج مكتبة خارجية
const store = new Map<string, Bucket>();
const MAX_STORE_SIZE = 10_000;

// ── حدود مختلفة حسب نوع العملية ──
interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  login:   { windowMs: 15 * 60 * 1000, maxAttempts: 7 },    // 7 محاولات / 15 دقيقة
  search:  { windowMs: 60 * 1000,       maxAttempts: 60 },   // 60 طلب / دقيقة
  deduct:  { windowMs: 60 * 1000,       maxAttempts: 30 },   // 30 عملية / دقيقة
  api:     { windowMs: 60 * 1000,       maxAttempts: 100 },  // 100 طلب / دقيقة
};

const DEFAULT_CONFIG: RateLimitConfig = { windowMs: 15 * 60 * 1000, maxAttempts: 10 };

function formatRateLimitMessage(remainingSec: number): string {
  if (remainingSec > 60) {
    const remainingMinutes = Math.ceil(remainingSec / 60);
    return `تم تجاوز الحد المسموح به. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`;
  }
  return `تم تجاوز الحد المسموح به. يرجى المحاولة بعد ${remainingSec} ثانية.`;
}

function checkRateLimitInMemory(key: string, config: RateLimitConfig): string | null {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || now >= bucket.resetAt) {
    // نافذة جديدة — التحقق من حد الذاكرة
    if (store.size >= MAX_STORE_SIZE) {
      const oldest = store.entries().next().value;
      if (oldest) store.delete(oldest[0]);
    }
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  if (bucket.count >= config.maxAttempts) {
    const remainingSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return formatRateLimitMessage(remainingSec);
  }

  bucket.count += 1;
  return null;
}

/** يُرجع null إذا مسموح، أو رسالة خطأ إذا تجاوز الحد */
export async function checkRateLimit(key: string, category: string = "login"): Promise<string | null> {
  const config = RATE_LIMITS[category] ?? DEFAULT_CONFIG;

  const redis = await getRedisPublisherClient();
  if (redis) {
    try {
      const redisKey = `rate-limit:${category}:${key}`;
      const count = await redis.incr(redisKey);

      if (count === 1) {
        await redis.pExpire(redisKey, config.windowMs);
      }

      if (count > config.maxAttempts) {
        const ttlMs = await redis.pTTL(redisKey);
        const remainingSec = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : config.windowMs) / 1000));
        return formatRateLimitMessage(remainingSec);
      }

      return null;
    } catch {
      // إذا فشل Redis — اسقط للـ fallback فقط في التطوير
    }
  }

  // ── في بيئة الإنتاج بدون Redis: نرفض الطلب بشكل آمن ──
  // منع Bypass هجمات عبر خوادم متعددة (Multi-Instance Attack)
  if (process.env.NODE_ENV === "production") {
    console.error(
      `[RATE-LIMIT] CRITICAL: Redis unavailable in production for key="${category}:${key}". ` +
      `Blocking request to prevent multi-instance rate-limit bypass.`
    );
    return "خدمة التحقق غير متاحة مؤقتاً. يرجى المحاولة لاحقاً.";
  }

  // بيئة التطوير: fallback للذاكرة مع تحذير
  console.warn(`[RATE-LIMIT] Using in-memory fallback (dev-only) for key="${category}:${key}"`);
  return checkRateLimitInMemory(key, config);
}

export async function resetRateLimit(key: string, category: string = "login"): Promise<void> {
  store.delete(key);

  const redis = await getRedisPublisherClient();
  if (!redis) {
    return;
  }

  try {
    await redis.del(`rate-limit:${category}:${key}`);
  } catch {
    // best effort
  }
}

// تنظيف تلقائي كل 5 دقائق لمنع تسرب الذاكرة
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      if (now >= bucket.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000);
}
