/**
 * Next.js Instrumentation Hook
 * =============================
 * يعمل مرة واحدة عند بدء السيرفر — نستخدمه لتشغيل BullMQ Worker
 * لمعالجة مهام الاستيراد من طابور Redis.
 */
export async function register() {
  // تشغيل Worker فقط في بيئة Node.js على السيرفر
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startImportWorker } = await import("@/lib/queue");
    const worker = await startImportWorker();
    if (worker) {
      console.log("[INSTRUMENTATION] BullMQ import worker started successfully");
    } else {
      console.warn("[INSTRUMENTATION] BullMQ import worker not started (no Redis connection)");
    }
  }
}
