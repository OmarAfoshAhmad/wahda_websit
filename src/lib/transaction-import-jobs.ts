import { ImportJobStatus, Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { processTransactionImport, type TransactionImportProgress, type TransactionImportResult } from "@/lib/import-transactions";

const TRANSACTION_IMPORT_KIND = "TRANSACTION_IMPORT" as const;

type TransactionImportPayload = {
  kind: typeof TRANSACTION_IMPORT_KIND;
  fileBase64: string;
  replaceOldImports: boolean;
};

type TransactionImportSummary = {
  auditLogId: string;
  importMode: "replace_old_imports" | "incremental_update";
  totalRows: number;
  duplicateCardCount: number;
  importedFamilies: number;
  importedTransactions: number;
  updatedFamilies: number;
  updatedTransactions: number;
  suspendedFamilies: number;
  balanceSetFamilies: number;
  skippedNotFound: number;
  cleanupDeletedImportTransactions: number;
  cleanupTouchedBeneficiaries: number;
  autoDebtAffectedDebtors: number;
  autoDebtSettledDebtors: number;
  autoDebtUnresolvedDebtors: number;
};

export type TransactionImportJobSnapshot = {
  id: string;
  status: ImportJobStatus;
  totalRows: number;
  processedRows: number;
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  message: string | null;
  result: TransactionImportSummary | null;
};

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parsePayload(payload: Prisma.JsonValue | null): TransactionImportPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  if (obj.kind !== TRANSACTION_IMPORT_KIND) return null;
  const fileBase64 = String(obj.fileBase64 ?? "").trim();
  if (!fileBase64) return null;
  return {
    kind: TRANSACTION_IMPORT_KIND,
    fileBase64,
    replaceOldImports: obj.replaceOldImports !== false,
  };
}

function summarizeResult(result: TransactionImportResult): TransactionImportSummary {
  return {
    auditLogId: result.auditLogId,
    importMode: result.importMode,
    totalRows: result.totalRows,
    duplicateCardCount: result.duplicateCardCount,
    importedFamilies: result.importedFamilies,
    importedTransactions: result.importedTransactions,
    updatedFamilies: result.updatedFamilies,
    updatedTransactions: result.updatedTransactions,
    suspendedFamilies: result.suspendedFamilies,
    balanceSetFamilies: result.balanceSetFamilies,
    skippedNotFound: result.skippedNotFound,
    cleanupDeletedImportTransactions: result.cleanupDeletedImportTransactions,
    cleanupTouchedBeneficiaries: result.cleanupTouchedBeneficiaries,
    autoDebtAffectedDebtors: result.autoDebtAffectedDebtors,
    autoDebtSettledDebtors: result.autoDebtSettledDebtors,
    autoDebtUnresolvedDebtors: result.autoDebtUnresolvedDebtors,
  };
}

function toSnapshot(job: {
  id: string;
  status: ImportJobStatus;
  total_rows: number;
  processed_rows: number;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  skipped_rows_report: Prisma.JsonValue | null;
}): TransactionImportJobSnapshot {
  const total = Math.max(1, Number(job.total_rows) || 1);
  const processed = Math.max(0, Math.min(total, Number(job.processed_rows) || 0));
  const progress = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));

  let message: string | null = null;
  let result: TransactionImportSummary | null = null;
  if (job.skipped_rows_report && typeof job.skipped_rows_report === "object" && !Array.isArray(job.skipped_rows_report)) {
    const report = job.skipped_rows_report as Record<string, unknown>;
    message = typeof report.message === "string" ? report.message : null;
    if (report.result && typeof report.result === "object" && !Array.isArray(report.result)) {
      const r = report.result as Record<string, unknown>;
      if (typeof r.auditLogId === "string") {
        result = {
          auditLogId: String(r.auditLogId),
          importMode: (r.importMode === "incremental_update" ? "incremental_update" : "replace_old_imports"),
          totalRows: Number(r.totalRows) || 0,
          duplicateCardCount: Number(r.duplicateCardCount) || 0,
          importedFamilies: Number(r.importedFamilies) || 0,
          importedTransactions: Number(r.importedTransactions) || 0,
          updatedFamilies: Number(r.updatedFamilies) || 0,
          updatedTransactions: Number(r.updatedTransactions) || 0,
          suspendedFamilies: Number(r.suspendedFamilies) || 0,
          balanceSetFamilies: Number(r.balanceSetFamilies) || 0,
          skippedNotFound: Number(r.skippedNotFound) || 0,
          cleanupDeletedImportTransactions: Number(r.cleanupDeletedImportTransactions) || 0,
          cleanupTouchedBeneficiaries: Number(r.cleanupTouchedBeneficiaries) || 0,
          autoDebtAffectedDebtors: Number(r.autoDebtAffectedDebtors) || 0,
          autoDebtSettledDebtors: Number(r.autoDebtSettledDebtors) || 0,
          autoDebtUnresolvedDebtors: Number(r.autoDebtUnresolvedDebtors) || 0,
        };
      }
    }
  }

  return {
    id: job.id,
    status: job.status,
    totalRows: total,
    processedRows: processed,
    progress,
    errorMessage: job.error_message,
    createdAt: job.created_at.toISOString(),
    startedAt: job.started_at?.toISOString() ?? null,
    completedAt: job.completed_at?.toISOString() ?? null,
    message,
    result,
  };
}

async function estimateRowsFromWorkbook(buffer: Buffer): Promise<number> {
  try {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return 1;

    let rows = 0;
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const vals = row.values as unknown[];
      const card = String(vals[1] ?? "").trim();
      if (card) rows++;
    });

    return Math.max(1, rows);
  } catch {
    return 1;
  }
}

export async function createTransactionImportJob(input: {
  fileBuffer: Buffer;
  username: string;
  replaceOldImports: boolean;
}) {
  const estimatedRows = await estimateRowsFromWorkbook(input.fileBuffer);
  const payload: TransactionImportPayload = {
    kind: TRANSACTION_IMPORT_KIND,
    fileBase64: input.fileBuffer.toString("base64"),
    replaceOldImports: input.replaceOldImports,
  };

  const job = await prisma.importJob.create({
    data: {
      created_by: input.username,
      status: "PENDING",
      payload: toJsonValue(payload),
      total_rows: estimatedRows,
      processed_rows: 0,
      inserted_rows: 0,
      duplicate_rows: 0,
      failed_rows: 0,
    },
  });

  return { job: toSnapshot(job) };
}

export async function getTransactionImportJobSnapshot(jobId: string, username?: string) {
  const job = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      ...(username ? { created_by: username } : {}),
    },
    select: {
      id: true,
      status: true,
      total_rows: true,
      processed_rows: true,
      error_message: true,
      created_at: true,
      started_at: true,
      completed_at: true,
      payload: true,
      skipped_rows_report: true,
    },
  });

  if (!job) return null;
  if (!parsePayload(job.payload)) return null;

  return toSnapshot(job);
}

export async function processTransactionImportJob(jobId: string, username: string) {
  const lock = await prisma.importJob.updateMany({
    where: {
      id: jobId,
      created_by: username,
      status: { in: ["PENDING", "FAILED"] },
    },
    data: {
      status: "PROCESSING",
      started_at: new Date(),
      completed_at: null,
      error_message: null,
      processed_rows: 0,
      inserted_rows: 0,
      duplicate_rows: 0,
      failed_rows: 0,
      skipped_rows_report: Prisma.JsonNull,
    },
  });

  const currentJob = await prisma.importJob.findFirst({
    where: { id: jobId, created_by: username },
    select: {
      id: true,
      status: true,
      payload: true,
      total_rows: true,
      processed_rows: true,
      error_message: true,
      created_at: true,
      started_at: true,
      completed_at: true,
      skipped_rows_report: true,
    },
  });

  if (!currentJob) {
    return { error: "لم يتم العثور على مهمة الاستيراد." };
  }

  const parsedPayload = parsePayload(currentJob.payload);
  if (!parsedPayload) {
    const failed = await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        status: "FAILED",
        error_message: "بيانات المهمة غير صالحة.",
        completed_at: new Date(),
      },
    });
    return { job: toSnapshot(failed), error: "بيانات المهمة غير صالحة." };
  }

  if (lock.count === 0) {
    return { job: toSnapshot(currentJob) };
  }

  const buffer = Buffer.from(parsedPayload.fileBase64, "base64");
  let lastProgressUpdate = 0;

  const onProgress = async (progress: TransactionImportProgress) => {
    const now = Date.now();
    if (now - lastProgressUpdate < 350 && progress.progressPercent < 100) return;
    lastProgressUpdate = now;

    await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        total_rows: Math.max(1, progress.totalRows),
        processed_rows: Math.max(0, progress.processedRows),
        skipped_rows_report: toJsonValue({
          message: progress.message,
          phase: progress.phase,
        }),
      },
    });
  };

  try {
    const processed = await processTransactionImport(buffer, username, undefined, {
      replaceOldImports: parsedPayload.replaceOldImports,
      onProgress,
    });

    if (processed.error || !processed.result) {
      const errorMessage = processed.error ?? "فشل الاستيراد.";
      const failedJob = await prisma.importJob.update({
        where: { id: currentJob.id },
        data: {
          status: "FAILED",
          error_message: errorMessage,
          completed_at: new Date(),
        },
      });
      return { job: toSnapshot(failedJob), error: errorMessage };
    }

    const summary = summarizeResult(processed.result);

    const completedJob = await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        status: "COMPLETED",
        total_rows: Math.max(1, processed.result.totalRows),
        processed_rows: Math.max(1, processed.result.totalRows),
        inserted_rows: processed.result.importedTransactions + processed.result.updatedTransactions,
        duplicate_rows: processed.result.duplicateCardCount,
        failed_rows: processed.result.skippedNotFound,
        skipped_rows_report: toJsonValue({
          message: "اكتملت مهمة استيراد الحركات بنجاح.",
          result: summary,
        }),
        completed_at: new Date(),
      },
    });

    return { job: toSnapshot(completedJob) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ أثناء معالجة الاستيراد.";
    const failedJob = await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        status: "FAILED",
        error_message: message,
        completed_at: new Date(),
      },
    });

    return { job: toSnapshot(failedJob), error: message };
  }
}
