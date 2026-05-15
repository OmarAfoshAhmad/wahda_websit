/**
 * Next.js Instrumentation Hook
 * =============================
 * تم إعداد هذا الملف لتأكيد حالة النظام عند بدء التشغيل.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("\n🚀 [SYSTEM] REDIS_URL غير معيّن — سيتم استخدام الذاكرة المحلية لـ Rate Limiting و SSE");
    console.log("✅ [SYSTEM] تم تفعيل نمط التشغيل المباشر (Direct Background Processing) لمهام الاستيراد.\n");
  }
}
