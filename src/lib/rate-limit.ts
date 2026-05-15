/**
 * In-memory rate limiter.
 * تم إلغاء Redis نهائياً لتبسيط البنية التحتية وتجنب مشاكل الاتصال.
 */

interface Bucket {
  count: number;
  resetAt: number; // timestamp ms
}

const store = new Map<string, Bucket>();
const MAX_STORE_SIZE = 10_000;

interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 7 },
  search: { windowMs: 60 * 1000, maxAttempts: 60 },
  deduct: { windowMs: 60 * 1000, maxAttempts: 30 },
  api: { windowMs: 60 * 1000, maxAttempts: 100 },
};

const DEFAULT_CONFIG: RateLimitConfig = { windowMs: 15 * 60 * 1000, maxAttempts: 10 };

function formatRateLimitMessage(remainingSec: number): string {
  if (remainingSec > 60) {
    const remainingMinutes = Math.ceil(remainingSec / 60);
    return `تم تجاوز الحد المسموح به. يرجى المحاولة بعد ${remainingMinutes} دقيقة.`;
  }
  return `تم تجاوز الحد المسموح به. يرجى المحاولة بعد ${remainingSec} ثانية.`;
}

export async function checkRateLimit(key: string, category: string = "login"): Promise<string | null> {
  const config = RATE_LIMITS[category] ?? DEFAULT_CONFIG;
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || now >= bucket.resetAt) {
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

export async function resetRateLimit(key: string, category: string = "login"): Promise<void> {
  store.delete(key);
}

// Cleanup interval
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      if (now >= bucket.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000);
}
