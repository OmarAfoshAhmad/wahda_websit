import { Prisma, ImportJobStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { INITIAL_BALANCE } from "@/lib/config";

const rawImportRowSchema = z.record(z.string(), z.unknown());

export type ImportJobSnapshot = {
  id: string;
  status: ImportJobStatus;
  totalRows: number;
  processedRows: number;
  insertedRows: number;
  duplicateRows: number;
  failedRows: number;
  errorMessage: string | null;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type NormalizedImportRow = {
  card_number: string;
  name: string;
  birth_date: Date | null;
};

type PreparedImportRow = {
  data: NormalizedImportRow;
  rawRow: Record<string, unknown>;
  rowNumber: number | null;
};

type SkippedImportReason = "invalid_row" | "missing_required_fields" | "duplicate_in_file" | "already_exists" | "duplicate_person";

type SkippedImportRowReport = {
  rowNumber: number | null;
  reason: SkippedImportReason;
  reasonLabel: string;
  card_number: string;
  name: string;
  birth_date: string | null;
  rawRow: Record<string, unknown>;
};

function normalizeString(value: unknown) {
  if (typeof value !== "string") {
    return String(value ?? "").trim();
  }

  return value.trim();
}

function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function personKey(name: string, birthDate: Date | null) {
  if (!birthDate) return null;
  return `${normalizePersonName(name)}|${birthDate.toISOString().slice(0, 10)}`;
}

function normalizeDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseExcelSerial(serial: number) {
  const excelEpoch = Date.UTC(1899, 11, 30);
  const parsed = new Date(excelEpoch + serial * 86400000);
  return Number.isNaN(parsed.getTime()) ? null : normalizeDateOnly(parsed);
}

function getSkippedReasonLabel(reason: SkippedImportReason) {
  switch (reason) {
    case "invalid_row":
      return "الصف غير صالح";
    case "missing_required_fields":
      return "الحقول الأساسية ناقصة";
    case "duplicate_in_file":
      return "مكرر داخل الملف نفسه";
    case "already_exists":
      return "رقم البطاقة موجود مسبقاً في النظام";
    case "duplicate_person":
      return "المستفيد نفسه (الاسم وتاريخ الميلاد) موجود مسبقاً";
    default:
      return "غير معروف";
  }
}

function getRowNumber(row: Record<string, unknown>) {
  const value = row.__rowNumber;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeRawRow(row: Record<string, unknown>) {
  const rest = { ...row };
  delete rest.__rowNumber;
  return rest;
}

function createSkippedRowReport(input: {
  reason: SkippedImportReason;
  rowNumber: number | null;
  rawRow: Record<string, unknown>;
  normalized?: NormalizedImportRow;
}) {
  return {
    rowNumber: input.rowNumber,
    reason: input.reason,
    reasonLabel: getSkippedReasonLabel(input.reason),
    card_number: input.normalized?.card_number ?? "",
    name: input.normalized?.name ?? "",
    birth_date: input.normalized?.birth_date?.toISOString().slice(0, 10) ?? null,
    rawRow: input.rawRow,
  } satisfies SkippedImportRowReport;
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// نطاق صالح لأرقام Excel التسلسلية (1 يناير 1900 → 31 ديسمبر 9999)
const EXCEL_SERIAL_MIN = 1;
const EXCEL_SERIAL_MAX = 2958465;

function parseBirthDate(value: unknown): Date | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : normalizeDateOnly(value);
  }

  if (typeof value === "number") {
    if (value < EXCEL_SERIAL_MIN || value > EXCEL_SERIAL_MAX) return null;
    return parseExcelSerial(value);
  }

  const str = typeof value === "string" ? value.trim() : String(value).trim();
  if (!str) return null;

  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    if (serial < EXCEL_SERIAL_MIN || serial > EXCEL_SERIAL_MAX) return null;
    return parseExcelSerial(serial);
  }

  const dmy = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    let year = Number(y);
    if (y.length === 2) year += year <= 30 ? 2000 : 1900;
    const candidate = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    if (!Number.isNaN(candidate.getTime()) && candidate.getUTCFullYear() === year) {
      return normalizeDateOnly(candidate);
    }
  }

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const year = Number(y);
    if (year >= 1 && year <= 9999) {
      const candidate = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
      return Number.isNaN(candidate.getTime()) ? null : normalizeDateOnly(candidate);
    }
  }

  return null;
}

function extractBirthDate(row: Record<string, unknown>) {
  return row.birth_date ?? row.date_of_birth ?? row.birthDate ?? row["تاريخ_الميلاد"] ?? row["تاريخ الميلاد"];
}

function getField(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in row) return row[key];
  }

  const trimmedEntries = Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v] as const);
  for (const key of keys) {
    const found = trimmedEntries.find(([k]) => k === key.toLowerCase());
    if (found) return found[1];
  }
  return undefined;
}

function normalizeImportRow(row: unknown): { data?: NormalizedImportRow; error?: SkippedImportReason } {
  const parsed = rawImportRowSchema.safeParse(row);
  if (!parsed.success) {
    return { error: "invalid_row" };
  }

  const cardNumber = normalizeString(getField(parsed.data, "card_number", "رقم البطاقة", "رقم_البطاقة", "الرقم")).toUpperCase();
  const name = normalizeString(getField(parsed.data, "name", "الاسم", "اسم المستفيد", "اسم_المستفيد"));
  if (!cardNumber || !name) {
    return { error: "missing_required_fields" };
  }

  const birthDateValue = extractBirthDate(parsed.data);
  const birthDate = parseBirthDate(birthDateValue);

  return {
    data: {
      card_number: cardNumber,
      name,
      birth_date: birthDate,
    },
  };
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function yieldToEventLoop() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function toSnapshot(job: {
  id: string;
  status: ImportJobStatus;
  total_rows: number;
  processed_rows: number;
  inserted_rows: number;
  duplicate_rows: number;
  failed_rows: number;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}): ImportJobSnapshot {
  const progress = job.total_rows === 0 ? 0 : Math.min(100, Math.round((job.processed_rows / job.total_rows) * 100));

  return {
    id: job.id,
    status: job.status,
    totalRows: job.total_rows,
    processedRows: job.processed_rows,
    insertedRows: job.inserted_rows,
    duplicateRows: job.duplicate_rows,
    failedRows: job.failed_rows,
    errorMessage: job.error_message,
    progress,
    createdAt: job.created_at.toISOString(),
    startedAt: job.started_at?.toISOString() ?? null,
    completedAt: job.completed_at?.toISOString() ?? null,
  };
}

export async function createImportJob(data: unknown[], username: string) {
  if (!Array.isArray(data) || data.length === 0) {
    return { error: "الملف لا يحتوي على صفوف قابلة للاستيراد." };
  }

  const job = await prisma.importJob.create({
    data: {
      created_by: username,
      payload: toJsonValue(data),
    total_rows: data.length,
    },
  });

  return { job: toSnapshot(job) };
}

export async function getImportJobSnapshot(jobId: string, username?: string) {
  const job = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      ...(username ? { created_by: username } : {}),
    },
  });

  if (!job) {
    return null;
  }

  return toSnapshot(job);
}

export async function processImportJob(jobId: string, username: string) {
  const lock = await prisma.importJob.updateMany({
    where: {
      id: jobId,
      created_by: username,
      status: {
        in: ["PENDING", "FAILED"],
      },
    },
    data: {
      status: "PROCESSING",
      started_at: new Date(),
      completed_at: null,
      error_message: null,
      skipped_rows_report: Prisma.JsonNull,
      processed_rows: 0,
      inserted_rows: 0,
      duplicate_rows: 0,
      failed_rows: 0,
    },
  });

  const currentJob = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      created_by: username,
    },
  });

  if (!currentJob) {
    return { error: "لم يتم العثور على مهمة الاستيراد." };
  }

  if (lock.count === 0) {
    return { job: toSnapshot(currentJob) };
  }

  const skippedRows: SkippedImportRowReport[] = [];

  try {
    const payload = Array.isArray(currentJob.payload) ? currentJob.payload : [];
    const uniqueRows: PreparedImportRow[] = [];
    const seenCards = new Set<string>();
    const seenPersons = new Set<string>();

    let processedRows = 0;
    let duplicateRows = 0;
    let failedRows = 0;
    let insertedRows = 0;

    for (const row of payload) {
      const parsedRow = rawImportRowSchema.safeParse(row);
      const rowNumber = parsedRow.success ? getRowNumber(parsedRow.data) : null;
      const rawRow = parsedRow.success ? sanitizeRawRow(parsedRow.data) : {};
      const normalized = normalizeImportRow(parsedRow.success ? parsedRow.data : row);

      if (!normalized.data) {
        failedRows += 1;
        processedRows += 1;
        skippedRows.push(createSkippedRowReport({
          reason: normalized.error ?? "invalid_row",
          rowNumber,
          rawRow,
        }));
        continue;
      }

      if (seenCards.has(normalized.data.card_number)) {
        duplicateRows += 1;
        processedRows += 1;
        skippedRows.push(createSkippedRowReport({
          reason: "duplicate_in_file",
          rowNumber,
          rawRow,
          normalized: normalized.data,
        }));
        continue;
      }

      const pKey = personKey(normalized.data.name, normalized.data.birth_date);
      if (pKey && seenPersons.has(pKey)) {
        duplicateRows += 1;
        processedRows += 1;
        skippedRows.push(createSkippedRowReport({
          reason: "duplicate_person",
          rowNumber,
          rawRow,
          normalized: normalized.data,
        }));
        continue;
      }

      seenCards.add(normalized.data.card_number);
      if (pKey) seenPersons.add(pKey);
      uniqueRows.push({
        data: normalized.data,
        rawRow,
        rowNumber,
      });
    }

    await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        processed_rows: processedRows,
        duplicate_rows: duplicateRows,
        failed_rows: failedRows,
      },
    });

    for (const chunk of chunkRows(uniqueRows, 100)) {
      const normalizedCardNumbers = [...new Set(chunk.map((row) => row.data.card_number.trim().toUpperCase()))];
      const existing = await prisma.$queryRaw<Array<{ normalized_card_number: string }>>`
        SELECT UPPER(BTRIM("card_number")) AS normalized_card_number
        FROM "Beneficiary"
        WHERE UPPER(BTRIM("card_number")) IN (${Prisma.join(normalizedCardNumbers)})
      `;

      const birthDateByTime = new Map<number, Date>();
      chunk.forEach((row) => {
        if (row.data.birth_date) {
          birthDateByTime.set(row.data.birth_date.getTime(), row.data.birth_date);
        }
      });
      const birthDates = [...birthDateByTime.values()];

      const existingPersons = birthDates.length > 0
        ? await prisma.beneficiary.findMany({
            where: {
              deleted_at: null,
              birth_date: { in: birthDates },
            },
            select: {
              name: true,
              birth_date: true,
            },
          })
        : [];

      const existingCards = new Set(existing.map((item) => item.normalized_card_number));
      const existingPersonKeys = new Set(
        existingPersons
          .map((row) => personKey(row.name, row.birth_date))
          .filter((key): key is string => Boolean(key))
      );

      const rowsToInsert = chunk.filter((row) => {
        const hasCardDuplicate = existingCards.has(row.data.card_number.trim().toUpperCase());
        if (hasCardDuplicate) return false;

        const pKey = personKey(row.data.name, row.data.birth_date);
        if (pKey && existingPersonKeys.has(pKey)) return false;

        return true;
      });

      chunk.forEach((row) => {
        if (existingCards.has(row.data.card_number.trim().toUpperCase())) {
          skippedRows.push(createSkippedRowReport({
            reason: "already_exists",
            rowNumber: row.rowNumber,
            rawRow: row.rawRow,
            normalized: row.data,
          }));
          return;
        }

        const pKey = personKey(row.data.name, row.data.birth_date);
        if (pKey && existingPersonKeys.has(pKey)) {
          skippedRows.push(createSkippedRowReport({
            reason: "duplicate_person",
            rowNumber: row.rowNumber,
            rawRow: row.rawRow,
            normalized: row.data,
          }));
        }
      });

      duplicateRows += chunk.length - rowsToInsert.length;
      processedRows += chunk.length;

      if (rowsToInsert.length > 0) {
        const result = await prisma.beneficiary.createMany({
          data: rowsToInsert.map((row) => ({
            card_number: row.data.card_number,
            name: row.data.name,
            birth_date: row.data.birth_date,
            total_balance: INITIAL_BALANCE,
            remaining_balance: INITIAL_BALANCE,
            status: "ACTIVE" as const,
          })),
          skipDuplicates: true,
        });
        insertedRows += result.count;
        duplicateRows += rowsToInsert.length - result.count;
      }

      await prisma.importJob.update({
        where: { id: currentJob.id },
        data: {
          processed_rows: processedRows,
          inserted_rows: insertedRows,
          duplicate_rows: duplicateRows,
          failed_rows: failedRows,
        },
      });

      await yieldToEventLoop();
    }

    const completedJob = await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        status: "COMPLETED",
        skipped_rows_report: toJsonValue(skippedRows),
        processed_rows: currentJob.total_rows,
        inserted_rows: insertedRows,
        duplicate_rows: duplicateRows,
        failed_rows: failedRows,
        completed_at: new Date(),
      },
    });

    // جلب facility_id من اسم المستخدم لربط سجل التدقيق
    const facility = await prisma.facility.findUnique({
      where: { username },
      select: { id: true },
    });

    await prisma.auditLog.create({
      data: {
        facility_id: facility?.id ?? undefined,
        user: username,
        action: "IMPORT_BENEFICIARIES_BACKGROUND",
        metadata: {
          jobId: currentJob.id,
          totalRows: currentJob.total_rows,
          insertedRows,
          duplicateRows,
          failedRows,
        },
      },
    });

    try {
      revalidatePath("/dashboard");
      revalidatePath("/import");
      revalidatePath("/beneficiaries");
    } catch {
      // revalidatePath غير متاح عند التشغيل من BullMQ Worker (خارج سياق الطلب)
    }

    return { job: toSnapshot(completedJob) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ أثناء معالجة الاستيراد.";
    const failedJob = await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        status: "FAILED",
        error_message: message,
        skipped_rows_report: skippedRows.length > 0 ? toJsonValue(skippedRows) : Prisma.JsonNull,
        completed_at: new Date(),
      },
    });

    return { job: toSnapshot(failedJob), error: message };
  }
}

export async function getImportJobSkippedRowsWorkbook(jobId: string, username?: string) {
  const job = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      ...(username ? { created_by: username } : {}),
    },
    select: {
      id: true,
      created_at: true,
      skipped_rows_report: true,
    },
  });

  if (!job) {
    return null;
  }

  const skippedRows = Array.isArray(job.skipped_rows_report)
    ? job.skipped_rows_report as unknown as SkippedImportRowReport[]
    : [];

  if (skippedRows.length === 0) {
    return { empty: true as const };
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("الحالات غير المستوردة");
  const dynamicKeys = Array.from(new Set(skippedRows.flatMap((row) => Object.keys(row.rawRow ?? {}))));

  worksheet.columns = [
    { header: "رقم الصف", key: "rowNumber", width: 12 },
    { header: "سبب عدم الاستيراد", key: "reasonLabel", width: 28 },
    { header: "رقم البطاقة", key: "card_number", width: 20 },
    { header: "الاسم", key: "name", width: 28 },
    { header: "تاريخ الميلاد", key: "birth_date", width: 18 },
    ...dynamicKeys.map((key) => ({ header: key, key: `raw:${key}`, width: 24 })),
  ];

  skippedRows.forEach((row) => {
    const sheetRow: Record<string, unknown> = {
      rowNumber: row.rowNumber ?? "",
      reasonLabel: row.reasonLabel,
      card_number: row.card_number,
      name: row.name,
      birth_date: row.birth_date ?? "",
    };

    dynamicKeys.forEach((key) => {
      const value = row.rawRow?.[key];
      sheetRow[`raw:${key}`] = value == null ? "" : String(value);
    });

    worksheet.addRow(sheetRow);
  });

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center" };

  const buffer = await workbook.xlsx.writeBuffer();
  const datePart = job.created_at.toISOString().slice(0, 10);

  return {
    empty: false as const,
    buffer: Buffer.from(buffer),
    fileName: `import-skipped-rows-${job.id}-${datePart}.xlsx`,
  };
}