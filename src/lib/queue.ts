/**
 * BullMQ Queue Manager
 * =====================
 * يوفر طوابير معالجة متينة للعمليات الثقيلة (Excel Import / Backup Restore).
 * يعتمد على Redis لضمان استمرار العمليات حتى لو انهار السيرفر وأُعيد تشغيله.
 * في بيئة التطوير بدون Redis: يُسقط تحذيراً ويُعيد null بدلاً من الانهيار.
 */

import type { Queue, Worker, Job } from "bullmq";

// نوع Job Data لاستيراد المستفيدين
export interface ImportJobData {
  jobId: string;
  username: string;
}

// Lazy-loaded Queue (لمنع crash عند بناء Next.js بدون REDIS_URL)
let importQueue: Queue<ImportJobData> | null = null;
let importWorker: Worker<ImportJobData> | null = null;

function getRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { URL } = require("url");
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      tls: parsed.protocol === "rediss:" ? {} : undefined,
    };
  } catch {
    return null;
  }
}

export async function getImportQueue(): Promise<Queue<ImportJobData> | null> {
  if (importQueue) return importQueue;

  const connection = getRedisConnection();
  if (!connection) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[QUEUE] CRITICAL: REDIS_URL is not set in production. Import jobs will NOT be queued reliably."
      );
    } else {
      console.warn("[QUEUE] REDIS_URL not set — BullMQ queue disabled in dev mode.");
    }
    return null;
  }

  const { Queue } = await import("bullmq");
  importQueue = new Queue<ImportJobData>("import-jobs", {
    connection,
    defaultJobOptions: {
      attempts: 3,                      // إعادة المحاولة 3 مرات عند الفشل
      backoff: { type: "exponential", delay: 5000 }, // انتظار متصاعد بين المحاولات
      removeOnComplete: { age: 3600 * 24 }, // الاحتفاظ بسجلات النجاح 24 ساعة
      removeOnFail: { age: 3600 * 72 },     // الاحتفاظ بسجلات الفشل 72 ساعة
    },
  });

  return importQueue;
}

/**
 * يضيف مهمة استيراد للطابور — تُنفَّذ بشكل آمن حتى لو انهار السيرفر
 */
export async function enqueueImportJob(jobId: string, username: string): Promise<boolean> {
  const queue = await getImportQueue();
  if (!queue) {
    // fallback: تشغيل مباشر بدون طابور (dev mode)
    return false;
  }

  await queue.add(`import:${jobId}`, { jobId, username }, { jobId });
  return true;
}

/**
 * تشغيل Worker لمعالجة طابور الاستيراد.
 * يُستدعى فقط من ملف worker مستقل (لا من Next.js app).
 */
export async function startImportWorker(): Promise<Worker<ImportJobData> | null> {
  if (importWorker) return importWorker;

  const connection = getRedisConnection();
  if (!connection) return null;

  const { Worker } = await import("bullmq");
  const { processImportJob } = await import("@/lib/import-jobs");

  importWorker = new Worker<ImportJobData>(
    "import-jobs",
    async (job: Job<ImportJobData>) => {
      console.log(`[WORKER] Processing import job: ${job.data.jobId}`);
      const result = await processImportJob(job.data.jobId, job.data.username);
      if (result.error) throw new Error(result.error);
      return result;
    },
    {
      connection,
      concurrency: 2, // معالجة مهمتين في نفس الوقت كحد أقصى
    }
  );

  importWorker.on("completed", (job) => {
    console.log(`[WORKER] Job ${job.id} completed successfully`);
  });

  importWorker.on("failed", (job, err) => {
    console.error(`[WORKER] Job ${job?.id} failed: ${err.message}`);
  });

  return importWorker;
}
