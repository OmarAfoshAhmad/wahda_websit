/**
 * BullMQ Queue Manager
 * =====================
 * يوفر طوابير معالجة متينة للعمليات الثقيلة (Excel Import / Backup Restore).
 * يعتمد على Redis لضمان استمرار العمليات حتى لو انهار السيرفر وأُعيد تشغيله.
 * في بيئة التطوير بدون Redis: يُسقط تحذيراً ويُعيد null بدلاً من الانهيار.
 */

import { URL } from "url";
import type { Queue, Worker, Job } from "bullmq";

// نوع Job Data لاستيراد المستفيدين
export interface ImportJobData {
  jobId: string;
  username: string;
}

export interface TransactionImportJobData {
  jobId: string;
  username: string;
}

// Lazy-loaded Queue (لمنع crash عند بناء Next.js بدون REDIS_URL)
let importQueue: Queue<ImportJobData> | null = null;
let importWorker: Worker<ImportJobData> | null = null;
let transactionImportQueue: Queue<TransactionImportJobData> | null = null;
let transactionImportWorker: Worker<TransactionImportJobData> | null = null;

function getRedisConnection() {
  const enableRedisInDev = process.env.ENABLE_REDIS_QUEUE === "true";
  if (process.env.NODE_ENV !== "production" && !enableRedisInDev) {
    return null;
  }

  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      tls: parsed.protocol === "rediss:" ? {} : undefined,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
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

export async function getTransactionImportQueue(): Promise<Queue<TransactionImportJobData> | null> {
  if (transactionImportQueue) return transactionImportQueue;

  const connection = getRedisConnection();
  if (!connection) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[QUEUE] CRITICAL: REDIS_URL is not set in production. Transaction import jobs will NOT be queued reliably."
      );
    } else {
      console.warn("[QUEUE] REDIS_URL not set — transaction import queue disabled in dev mode.");
    }
    return null;
  }

  const { Queue } = await import("bullmq");
  transactionImportQueue = new Queue<TransactionImportJobData>("transaction-import-jobs", {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { age: 3600 * 24 },
      removeOnFail: { age: 3600 * 72 },
    },
  });

  return transactionImportQueue;
}

/**
 * يضيف مهمة استيراد للطابور — تُنفَّذ بشكل آمن حتى لو انهار السيرفر
 */
export async function enqueueImportJob(jobId: string, username: string): Promise<boolean> {
  try {
    const queue = await getImportQueue();
    if (!queue) {
      // fallback: تشغيل مباشر بدون طابور (dev mode)
      return false;
    }

    await queue.add(`import:${jobId}`, { jobId, username }, { jobId });
    return true;
  } catch (error) {
    if (importQueue) {
      try {
        await importQueue.close();
      } catch {
        // تجاهل أخطاء الإغلاق
      }
      importQueue = null;
    }

    console.warn("[QUEUE] enqueue failed; falling back to direct processing", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function enqueueTransactionImportJob(jobId: string, username: string): Promise<boolean> {
  try {
    const queue = await getTransactionImportQueue();
    if (!queue) {
      return false;
    }

    await queue.add(`tx-import:${jobId}`, { jobId, username }, { jobId: `tx:${jobId}` });
    return true;
  } catch (error) {
    if (transactionImportQueue) {
      try {
        await transactionImportQueue.close();
      } catch {
        // تجاهل أخطاء الإغلاق
      }
      transactionImportQueue = null;
    }

    console.warn("[QUEUE] transaction enqueue failed; falling back to direct processing", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
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

export async function startTransactionImportWorker(): Promise<Worker<TransactionImportJobData> | null> {
  if (transactionImportWorker) return transactionImportWorker;

  const connection = getRedisConnection();
  if (!connection) return null;

  const { Worker } = await import("bullmq");
  const { processTransactionImportJob } = await import("@/lib/transaction-import-jobs");

  transactionImportWorker = new Worker<TransactionImportJobData>(
    "transaction-import-jobs",
    async (job: Job<TransactionImportJobData>) => {
      console.log(`[WORKER] Processing transaction import job: ${job.data.jobId}`);
      const result = await processTransactionImportJob(job.data.jobId, job.data.username);
      if (result.error) throw new Error(result.error);
      return result;
    },
    {
      connection,
      concurrency: 1,
    }
  );

  transactionImportWorker.on("completed", (job) => {
    console.log(`[WORKER] Transaction import job ${job.id} completed successfully`);
  });

  transactionImportWorker.on("failed", (job, err) => {
    console.error(`[WORKER] Transaction import job ${job?.id} failed: ${err.message}`);
  });

  return transactionImportWorker;
}
