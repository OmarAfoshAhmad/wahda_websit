/**
 * PostgreSQL-backed rate limiter.
 * مشترك بين جميع نسخ التطبيق ولا يحتاج Redis أو خدمة خارجية.
 */

import prisma from "@/lib/prisma";

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
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 7 },    // 7 محاولات / 15 دقيقة
  search: { windowMs: 60 * 1000, maxAttempts: 60 },   // 60 طلب / دقيقة
  deduct: { windowMs: 60 * 1000, maxAttempts: 30 },   // 30 عملية / دقيقة
  api: { windowMs: 60 * 1000, maxAttempts: 100 },  // 100 طلب / دقيقة
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
  const bucketKey = `${category}:${key}`;

  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; reset_at: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "reset_at", "updated_at")
      VALUES (${bucketKey}, 1, NOW() + (${config.windowMs} * INTERVAL '1 millisecond'), NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."reset_at" <= NOW() THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "reset_at" = CASE
          WHEN "RateLimitBucket"."reset_at" <= NOW()
            THEN NOW() + (${config.windowMs} * INTERVAL '1 millisecond')
          ELSE "RateLimitBucket"."reset_at"
        END,
        "updated_at" = NOW()
      RETURNING "count", "reset_at"
    `;

    const bucket = rows[0];
    if (bucket && bucket.count > config.maxAttempts) {
      const remainingSec = Math.max(1, Math.ceil((bucket.reset_at.getTime() - Date.now()) / 1000));
      return formatRateLimitMessage(remainingSec);
    }
    return null;
  } catch (err) {
    console.error("[RATE-LIMIT] PostgreSQL limiter failed", String(err));
    if (process.env.NODE_ENV === "production") {
      return "خدمة التحقق غير متاحة مؤقتاً. يرجى المحاولة لاحقاً.";
    }
    return checkRateLimitInMemory(bucketKey, config);
  }
}

export async function resetRateLimit(key: string, category: string = "login"): Promise<void> {
  const bucketKey = `${category}:${key}`;
  store.delete(bucketKey);

  try {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${bucketKey}`;
  } catch (err) {
    console.warn("[RATE-LIMIT] PostgreSQL reset failed", String(err));
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
