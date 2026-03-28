/**
 * ecosystem.config.js — PM2 Cluster Configuration
 * ================================================
 * يُشغّل نسختين من Next.js على نفس السيرفر (2 CPU VPS).
 * كل نسخة تواجه منفذاً مختلفاً، وNginx يوزع الحمل بينهما.
 *
 * الاستخدام:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   (تشغيل تلقائي عند إعادة بدء السيرفر)
 *
 * المراقبة:
 *   pm2 monit     (مراقبة مباشرة CPU/RAM)
 *   pm2 logs      (سجلات الأخطاء والمعلومات)
 */

const os = require("os");

// عدد النسخ = عدد الـ CPUs (2 في حالة VPS من CPU مزدوج)
// في Serverless أو Docker، استخدم "max"
const INSTANCES = Math.max(1, os.cpus().length);

module.exports = {
  apps: [
    {
      name: "waha-health-care",
      script: "server.js", // ملف Next.js standalone
      instances: INSTANCES,
      exec_mode: "cluster",   // مشاركة المنفذ عبر الـ cluster
      
      // ─── ذاكرة وأداء ────────────────────────────────────────
      max_memory_restart: "1500M", // إعادة تشغيل أوتوماتيكي عند تجاوز 1.5GB لكل instance
      node_args: "--max-old-space-size=1500", // حجم Heap لكل عامل
      
      // ─── متغيرات البيئة ──────────────────────────────────────
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        // IMPORTANT: أضف DATABASE_URL و JWT_SECRET هنا أو في .env
      },
      
      // ─── إعادة التشغيل التلقائي (Auto-restart) ───────────────
      restart_delay: 3000,        // انتظر 3 ثوانٍ قبل إعادة التشغيل
      max_restarts: 10,           // أقصى 10 إعادات متتالية
      min_uptime: "10s",          // يجب أن يظل حياً 10 ثوانٍ قبل اعتباره ناجح
      autorestart: true,
      
      // ─── Grace shutdown ───────────────────────────────────────
      kill_timeout: 10000,        // 10 ثوانٍ لإنهاء الطلبات الحالية قبل الإيقاف
      listen_timeout: 8000,       // وقت انتظار استعداد التطبيق
      
      // ─── السجلات ─────────────────────────────────────────────
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      
      // ─── المراقبة والصحة ─────────────────────────────────────
      pmx: false, // تعطيل PM2 Plus Profiling (اختياري)
    },
  ],
};
