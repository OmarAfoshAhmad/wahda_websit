import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { processImportJob } from "@/lib/import-jobs";
import { processTransactionImportJob } from "@/lib/transaction-import-jobs";

declare global {
  var _postgresImportWorkerTimer: ReturnType<typeof setInterval> | undefined;
  var _postgresImportWorkerRunning: boolean | undefined;
}

function isTransactionImport(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload)
    && (payload as Record<string, unknown>).kind === "TRANSACTION_IMPORT");
}

async function runNextPendingImport() {
  if (globalThis._postgresImportWorkerRunning) return;
  globalThis._postgresImportWorkerRunning = true;
  try {
    const job = await prisma.importJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { created_at: "asc" },
      select: { id: true, created_by: true, payload: true },
    });
    if (!job) return;

    if (isTransactionImport(job.payload)) {
      await processTransactionImportJob(job.id, job.created_by);
    } else {
      await processImportJob(job.id, job.created_by);
    }
  } catch (error) {
    logger.error("PostgreSQL import worker failed", { error: String(error) });
  } finally {
    globalThis._postgresImportWorkerRunning = false;
  }
}

export function wakePostgresImportWorker() {
  void runNextPendingImport();
}

export function startPostgresImportWorker() {
  if (globalThis._postgresImportWorkerTimer) return;
  void prisma.importJob.updateMany({
    where: {
      status: "PROCESSING",
      started_at: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    },
    data: {
      status: "FAILED",
      completed_at: new Date(),
      error_message: "توقفت مهمة الاستيراد بسبب إعادة تشغيل الخادم؛ راجع التقرير ثم أعد المحاولة.",
    },
  }).catch((error) => logger.error("Failed to recover stale import jobs", { error: String(error) }));
  wakePostgresImportWorker();
  const timer = setInterval(wakePostgresImportWorker, 2_000);
  timer.unref?.();
  globalThis._postgresImportWorkerTimer = timer;
}
