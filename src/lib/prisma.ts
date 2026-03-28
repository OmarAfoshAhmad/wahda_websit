import { PrismaClient } from "@prisma/client";
import os from "os";

// ─── حساب حجم Connection Pool الأمثل تلقائياً ───────────────────────────────
// القاعدة: عدد الـ CPUs × 2 للعمليات I/O كثيفة (DB queries)
// الحد الأدنى: 5 اتصالات | الحد الأقصى: 50 اتصالاً (قبل الحاجة لـ PgBouncer)
function computePoolSize(): number {
  const cpus = os.cpus().length;
  if (process.env.NODE_ENV !== "production") return 3; // بيئة تطوير: اتصالات قليلة
  const calculated = Math.min(50, Math.max(5, cpus * 2));
  return calculated;
}

const POOL_SIZE = computePoolSize();
const POOL_TIMEOUT = 30; // ثواني — وقت انتظار اتصال حر من المجمع
const SLOW_QUERY_MS = process.env.NODE_ENV === "production" ? 300 : 150;

const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    datasourceUrl: appendPoolParams(process.env.DATABASE_URL ?? ""),
  });

  // مراقبة الأداء: تسجيل الاستعلامات البطيئة تلقائياً
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          const start = performance.now();
          const result = await query(args);
          const elapsed = performance.now() - start;

          if (elapsed > SLOW_QUERY_MS) {
            console.warn(
              `[PERFORMANCE] Slow query: ${model}.${operation} → ${elapsed.toFixed(0)}ms` +
              ` (threshold: ${SLOW_QUERY_MS}ms, pool: ${POOL_SIZE} connections)`
            );
          }

          return result;
        },
      },
    },
  });
};

/**
 * يضيف معاملات الـ Connection Pool للـ DATABASE_URL.
 * إذا كان الاتصال عبر PgBouncer (pgbouncer=true في الرابط)،
 * لا نضيف connection_limit لنتجنب التعارض مع PgBouncer الخارجي.
 */
function appendPoolParams(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);

    // PgBouncer يدير الـ pool بنفسه — لا نتدخل
    const isPgBouncer = u.searchParams.get("pgbouncer") === "true";

    if (!isPgBouncer) {
      if (!u.searchParams.has("connection_limit")) {
        u.searchParams.set("connection_limit", String(POOL_SIZE));
      }
      if (!u.searchParams.has("pool_timeout")) {
        u.searchParams.set("pool_timeout", String(POOL_TIMEOUT));
      }
    }

    return u.toString();
  } catch {
    return url;
  }
}

// تسجيل المعلومات عند الإقلاع (مرة واحدة فقط)
if (process.env.NODE_ENV === "production") {
  console.info(
    `[PRISMA] Pool: ${POOL_SIZE} connections | Timeout: ${POOL_TIMEOUT}s | ` +
    `CPUs: ${os.cpus().length} | Slow-query threshold: ${SLOW_QUERY_MS}ms`
  );
}

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prisma ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;

