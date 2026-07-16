/**
 * Next.js Instrumentation Hook
 * =============================
 * يعمل مرة واحدة عند بدء السيرفر لتشغيل عامل مهام الاستيراد المخزنة في PostgreSQL.
 */
export async function register() {
  // تشغيل Worker فقط في بيئة Node.js على السيرفر
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPostgresImportWorker } = await import("@/lib/postgres-import-worker");
    startPostgresImportWorker();
  }
}
