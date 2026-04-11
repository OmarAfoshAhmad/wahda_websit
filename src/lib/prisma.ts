import { PrismaClient } from "@prisma/client";
import os from "os";

// ─── حساب حجم Connection Pool الأمثل تلقائياً ───────────────────────────────
// قاعدة ذهبية: PostgreSQL الافتراضية تسمح بـ 100 اتصال كحد أقصى.
// عدد نسخ التطبيق يعتمد على عدد CPU (cluster mode).
// على سيرفر 4 CPU: يتم توزيع 80 اتصالاً على 4 نسخ = 20 اتصالاً لكل نسخة.
function computePoolSize(): number {
  if (process.env.NODE_ENV !== "production") return 3; // بيئة تطوير: اتصالات قليلة
  const cpus = os.cpus().length || 1;
  // تخصيص 80 اتصالاً كحد أقصى وتوزيعها على عدد الأنوية لضمان عدم تجاوز سعة قاعدة البيانات
  const calculated = Math.floor(80 / cpus);
  // نضمن أن الحد الأدنى لكل نسخة هو اتصالين (2) على الأقل
  return Math.max(2, calculated);
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
  var prismaVersion: undefined | string;
}

const PRISMA_CLIENT_VERSION = "v2-no-audit-chain";

let prisma: ReturnType<typeof prismaClientSingleton>;
const cachedPrisma = globalThis.prisma;

if (!cachedPrisma || globalThis.prismaVersion !== PRISMA_CLIENT_VERSION) {
  // DEV-FIX: إذا تغيّر تكوين Prisma أثناء HMR، نتخلص من النسخة القديمة لتفادي السلوك العالق
  if (process.env.NODE_ENV !== "production" && cachedPrisma) {
    cachedPrisma.$disconnect().catch(() => undefined);
  }
  prisma = prismaClientSingleton();
} else {
  prisma = cachedPrisma;
}

export default prisma;

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
  globalThis.prismaVersion = PRISMA_CLIENT_VERSION;
}

