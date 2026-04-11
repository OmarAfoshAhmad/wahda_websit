import { Prisma, ImportJobStatus } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { personKey } from "@/lib/normalize";

const rawImportRowSchema = z.record(z.string(), z.unknown());

export type ImportJobSnapshot = {
  id: string;
  status: ImportJobStatus;
  totalRows: number;
  processedRows: number;
  insertedRows: number;
  duplicateRows: number;
  failedRows: number;
  updatedRows?: number;
  errorMessage: string | null;
  progress: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  canRollback?: boolean;
};

export type ImportOptions = {
  updateBalance: boolean;
  reactivate: boolean;
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

function normalizeString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  // ExcelJS RichText: { richText: [{ text: "..." }, ...] }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v !== null && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: unknown }>)
        .map((r) => String(r.text ?? ""))
        .join("")
        .trim();
    }
    // Handle sheetjs / exceljs formula results or other nested objects
    if (v !== null && "result" in v) {
      return String(v.result ?? "").trim();
    }
    if (v !== null && "text" in v) {
      return String(v.text ?? "").trim();
    }
    if (v !== null && "value" in v) {
      return String(v.value ?? "").trim();
    }
    // Fallback: try to serialize to avoid [object Object] if possible, or just empty
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return String(value).trim();
}

// normalizePersonName و personKey مستوردة من @/lib/normalize لضمان الاتساق مع بقية المنظومة

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
  return row.birth_date ?? row.date_of_birth ?? row.birthDate ?? row["تاريخ_الميلاد"] ?? row["تاريخ الميلاد"] ?? row.DOB ?? row.dob;
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

  const cardNumber = normalizeString(getField(parsed.data, "card_number", "رقم البطاقة", "رقم_البطاقة", "الرقم", "رقم_بطاقة", "insurance profile", "Insurance Profile")).toUpperCase();
  const name = normalizeString(getField(parsed.data, "name", "الاسم", "الإسم", "اسم المستفيد", "اسم_المستفيد", "employee name", "Employee Name"));

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
  skipped_rows_report?: Prisma.JsonValue | null;
  rollback_data?: Prisma.JsonValue | null;
}): ImportJobSnapshot {
  const progress = job.total_rows === 0 ? 0 : Math.min(100, Math.round((job.processed_rows / job.total_rows) * 100));

  let updatedRowsCount: number | undefined;
  if (job.skipped_rows_report && !Array.isArray(job.skipped_rows_report) && typeof job.skipped_rows_report === "object" && "updatedRows" in job.skipped_rows_report) {
    updatedRowsCount = Number((job.skipped_rows_report as Record<string, unknown>).updatedRows);
  }

  const hasRollbackData = job.rollback_data != null && typeof job.rollback_data === "object";

  return {
    id: job.id,
    status: job.status,
    totalRows: job.total_rows,
    processedRows: job.processed_rows,
    insertedRows: job.inserted_rows,
    duplicateRows: job.duplicate_rows,
    failedRows: job.failed_rows,
    updatedRows: updatedRowsCount,
    errorMessage: job.error_message,
    progress,
    createdAt: job.created_at.toISOString(),
    startedAt: job.started_at?.toISOString() ?? null,
    completedAt: job.completed_at?.toISOString() ?? null,
    canRollback: job.status === "COMPLETED" && hasRollbackData,
  };
}

const MAX_IMPORT_ROWS = 10_000;

export async function createImportJob(data: unknown[], username: string, options?: ImportOptions) {
  if (!Array.isArray(data) || data.length === 0) {
    return { error: "الملف لا يحتوي على صفوف قابلة للاستيراد." };
  }

  if (data.length > MAX_IMPORT_ROWS) {
    return { error: `عدد الصفوف (${data.length}) يتجاوز الحد الأقصى المسموح به (${MAX_IMPORT_ROWS}). يرجى تقسيم الملف.` };
  }

  const job = await prisma.importJob.create({
    data: {
      created_by: username,
      payload: toJsonValue(data),
      total_rows: data.length,
      options: options ? toJsonValue(options) : undefined,
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
  const initialBalance = await getCurrentInitialBalance();

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

  // قراءة خيارات الاستيراد
  const opts: ImportOptions = {
    updateBalance: false,
    reactivate: false,
  };
  if (currentJob.options && typeof currentJob.options === "object" && !Array.isArray(currentJob.options)) {
    const rawOpts = currentJob.options as Record<string, unknown>;
    if (rawOpts.updateBalance === true) opts.updateBalance = true;
    if (rawOpts.reactivate === true) opts.reactivate = true;
  }

  // بيانات التراجع
  const rollbackCreatedIds: string[] = [];
  const rollbackBeforeSnapshots: Array<{
    id: string;
    name: string;
    birth_date: string | null;
    total_balance: string;
    remaining_balance: string;
    status: string;
    deleted_at: string | null;
  }> = [];
  const rollbackRestoredIds: string[] = []; // IDs of soft-deleted records that were restored

  try {
    const payload = Array.isArray(currentJob.payload) ? currentJob.payload : [];
    const uniqueRows: PreparedImportRow[] = [];
    const seenCards = new Set<string>();
    const seenPersons = new Set<string>();

    let processedRows = 0;
    let duplicateRows = 0;
    let failedRows = 0;
    let insertedRows = 0;
    let updatedRows = 0; // عداد منفصل للسجلات المحدَّثة (ليست إدراجاً جديداً)

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

      // البحث يشمل المحذوفين soft-delete لتفادي إنشاء سجل مكرر
      const existingActive = await prisma.$queryRaw<Array<{ normalized_card_number: string }>>`
        SELECT UPPER(BTRIM("card_number")) AS normalized_card_number
        FROM "Beneficiary"
        WHERE UPPER(BTRIM("card_number")) IN (${Prisma.join(normalizedCardNumbers)})
          AND "deleted_at" IS NULL
      `;
      const existingDeleted = await prisma.$queryRaw<Array<{ normalized_card_number: string }>>`
        SELECT UPPER(BTRIM("card_number")) AS normalized_card_number
        FROM "Beneficiary"
        WHERE UPPER(BTRIM("card_number")) IN (${Prisma.join(normalizedCardNumbers)})
          AND "deleted_at" IS NOT NULL
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

      const activeCards = new Set(existingActive.map((item) => item.normalized_card_number));
      const deletedCards = new Set(existingDeleted.map((item) => item.normalized_card_number));

      // جلب السجلات الحية الموجودة للتحديث
      const existingActiveRows = existingActive.length > 0
        ? await prisma.beneficiary.findMany({
          where: {
            card_number: { in: [...activeCards], mode: "insensitive" },
            deleted_at: null,
          },
          select: { id: true, card_number: true, name: true, birth_date: true, total_balance: true, remaining_balance: true, status: true },
        })
        : [];
      const cardToActiveRow = new Map(
        existingActiveRows.map((r) => [r.card_number.trim().toUpperCase(), r])
      );

      // جلب السجلات المحذوفة soft-delete لاستعادتها بدل إنشاء سجل جديد
      const existingDeletedRows = existingDeleted.length > 0
        ? await prisma.beneficiary.findMany({
          where: {
            card_number: { in: [...deletedCards], mode: "insensitive" },
            deleted_at: { not: null },
          },
          select: { id: true, card_number: true, name: true, birth_date: true, total_balance: true, remaining_balance: true, status: true, deleted_at: true },
          // آخر سجل محذوف لهذا الرقم
          orderBy: { deleted_at: "desc" },
        })
        : [];
      const cardToDeletedRow = new Map(
        existingDeletedRows.map((r) => [r.card_number.trim().toUpperCase(), r])
      );

      const existingPersonKeys = new Set(
        existingPersons
          .map((row) => personKey(row.name, row.birth_date))
          .filter((key): key is string => Boolean(key))
      );

      const rowsToInsert = chunk.filter((row) => {
        const cn = row.data.card_number.trim().toUpperCase();
        if (activeCards.has(cn)) return false;
        if (deletedCards.has(cn)) return false; // سيُستعاد بدل الإنشاء

        const pKey = personKey(row.data.name, row.data.birth_date);
        if (pKey && existingPersonKeys.has(pKey)) return false;

        return true;
      });

      // صفوف سيتم تحديثها (رقم البطاقة موجود وحيّ)
      const rowsToUpdate = chunk.filter((row) =>
        activeCards.has(row.data.card_number.trim().toUpperCase())
      );

      // صفوف محذوفة سيتم استعادتها
      const rowsToRestore = chunk.filter((row) => {
        const cn = row.data.card_number.trim().toUpperCase();
        return !activeCards.has(cn) && deletedCards.has(cn);
      });

      // صفوف مكررة (نفس الشخص، بطاقة مختلفة) — لا تزال تُتخطى
      chunk.forEach((row) => {
        const cn = row.data.card_number.trim().toUpperCase();
        if (activeCards.has(cn) || deletedCards.has(cn)) return;

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

      const trueDuplicates = chunk.filter((row) => {
        const cn = row.data.card_number.trim().toUpperCase();
        if (activeCards.has(cn) || deletedCards.has(cn)) return false;
        const pKey = personKey(row.data.name, row.data.birth_date);
        return pKey !== null && existingPersonKeys.has(pKey);
      }).length;

      duplicateRows += trueDuplicates;
      processedRows += chunk.length;

      // إدراج المستفيدين الجدد
      if (rowsToInsert.length > 0) {
        const result = await prisma.beneficiary.createMany({
          data: rowsToInsert.map((row) => ({
            card_number: row.data.card_number,
            name: row.data.name,
            birth_date: row.data.birth_date,
            total_balance: initialBalance,
            remaining_balance: initialBalance,
            status: "ACTIVE" as const,
          })),
          skipDuplicates: true,
        });
        insertedRows += result.count;
        duplicateRows += rowsToInsert.length - result.count;

        // حفظ IDs المنشأة حديثاً للتراجع
        if (result.count > 0) {
          const newlyCreated = await prisma.beneficiary.findMany({
            where: {
              card_number: { in: rowsToInsert.map((r) => r.data.card_number), mode: "insensitive" },
              deleted_at: null,
            },
            select: { id: true },
          });
          rollbackCreatedIds.push(...newlyCreated.map((r) => r.id));
        }
      }

      // استعادة السجلات المحذوفة soft-delete
      // SEC-FIX: استبدال Promise.all بحلقة متسلسلة لمنع deadlocks
      if (rowsToRestore.length > 0) {
        for (const row of rowsToRestore) {
            const cn = row.data.card_number.trim().toUpperCase();
            const deletedRow = cardToDeletedRow.get(cn);
            if (!deletedRow) continue;

            // حفظ snapshot قبل الاستعادة
            rollbackBeforeSnapshots.push({
              id: deletedRow.id,
              name: deletedRow.name,
              birth_date: deletedRow.birth_date?.toISOString() ?? null,
              total_balance: String(deletedRow.total_balance),
              remaining_balance: String(deletedRow.remaining_balance),
              status: deletedRow.status,
              deleted_at: deletedRow.deleted_at?.toISOString() ?? null,
            });

            await prisma.beneficiary.update({
              where: { id: deletedRow.id },
              data: {
                deleted_at: null,
                name: row.data.name,
                birth_date: row.data.birth_date,
                status: "ACTIVE",
                ...(opts.updateBalance ? {
                  total_balance: initialBalance,
                  remaining_balance: initialBalance,
                } : {}),
              },
            });
            rollbackRestoredIds.push(deletedRow.id);
        }
        insertedRows += rowsToRestore.length; // تُحسب كإدراج لأنها استعادة
      }

      // تحديث المستفيدين الموجودين
      // SEC-FIX: استبدال Promise.all بحلقة متسلسلة لمنع deadlocks
      if (rowsToUpdate.length > 0) {
        let successfulUpdates = 0;
        for (const row of rowsToUpdate) {
            const cn = row.data.card_number.trim().toUpperCase();
            const activeRow = cardToActiveRow.get(cn);
            if (!activeRow) continue;

            // حفظ snapshot قبل التحديث
            rollbackBeforeSnapshots.push({
              id: activeRow.id,
              name: activeRow.name,
              birth_date: activeRow.birth_date?.toISOString() ?? null,
              total_balance: String(activeRow.total_balance),
              remaining_balance: String(activeRow.remaining_balance),
              status: activeRow.status,
              deleted_at: null,
            });

            const updateData: Record<string, unknown> = {
              name: row.data.name,
              birth_date: row.data.birth_date,
            };

            // تحديث الرصيد إذا طلب المستخدم ذلك
            if (opts.updateBalance) {
              updateData.total_balance = initialBalance;
              updateData.remaining_balance = initialBalance;
            }

            // إعادة التفعيل إذا طلب المستخدم ذلك
            if (opts.reactivate && activeRow.status !== "ACTIVE") {
              updateData.status = "ACTIVE";
            }

            await prisma.beneficiary.update({
              where: { id: activeRow.id },
              data: updateData,
            });
            successfulUpdates++;
        }
        updatedRows += successfulUpdates;
      }

      await prisma.importJob.update({
        where: { id: currentJob.id },
        data: {
          processed_rows: processedRows,
          inserted_rows: insertedRows,
          duplicate_rows: duplicateRows,
          failed_rows: failedRows,
          // updatedRows مخزنة مؤقتاً في skipped_rows_report لحين إضافة عمود مستقل
        },
      });

      await yieldToEventLoop();
    }

    const completedJob = await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        status: "COMPLETED",
        skipped_rows_report: toJsonValue({ rows: skippedRows, updatedRows }),
        rollback_data: toJsonValue({
          createdIds: rollbackCreatedIds,
          restoredIds: rollbackRestoredIds,
          beforeSnapshots: rollbackBeforeSnapshots,
        }),
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
          updatedRows,
          duplicateRows,
          failedRows,
        },
      },
    });

    try {
      revalidatePath("/dashboard");
      revalidatePath("/import");
      revalidatePath("/beneficiaries");
      revalidateTag("beneficiary-counts", "max");
    } catch {
      // revalidatePath غير متاح عند التشغيل من BullMQ Worker (خارج سياق الطلب)
    }

    return { job: toSnapshot(completedJob) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ أثناء معالجة الاستيراد.";

    // SEC-FIX: حفظ بيانات التراجع حتى عند الفشل لإمكانية التنظيف
    const partialRollbackData = (rollbackCreatedIds.length > 0 || rollbackRestoredIds.length > 0 || rollbackBeforeSnapshots.length > 0)
      ? toJsonValue({
          createdIds: rollbackCreatedIds,
          restoredIds: rollbackRestoredIds,
          beforeSnapshots: rollbackBeforeSnapshots,
        })
      : Prisma.JsonNull;

    // SEC-FIX: محاولة التراجع التلقائي عند الفشل الجزئي
    let autoRollbackResult = "";
    if (rollbackCreatedIds.length > 0 || rollbackRestoredIds.length > 0) {
      try {
        let autoDeletedCount = 0;
        let autoRestoredCount = 0;
        let autoRevertedCount = 0;

        // حذف المُنشأين الجدد
        if (rollbackCreatedIds.length > 0) {
          const r = await prisma.beneficiary.updateMany({
            where: { id: { in: rollbackCreatedIds }, deleted_at: null },
            data: { deleted_at: new Date() },
          });
          autoDeletedCount = r.count;
        }

        // استعادة السجلات المستعادة لحالتها المحذوفة
        for (const snap of rollbackBeforeSnapshots.filter((s) => rollbackRestoredIds.includes(s.id))) {
          await prisma.beneficiary.update({
            where: { id: snap.id },
            data: {
              name: snap.name,
              birth_date: snap.birth_date ? new Date(snap.birth_date) : null,
              total_balance: parseFloat(snap.total_balance),
              remaining_balance: parseFloat(snap.remaining_balance),
              status: snap.status as "ACTIVE" | "FINISHED" | "SUSPENDED",
              deleted_at: snap.deleted_at ? new Date(snap.deleted_at) : null,
            },
          });
          autoRestoredCount++;
        }

        // استعادة السجلات المحدَّثة
        for (const snap of rollbackBeforeSnapshots.filter((s) => !rollbackRestoredIds.includes(s.id))) {
          await prisma.beneficiary.update({
            where: { id: snap.id },
            data: {
              name: snap.name,
              birth_date: snap.birth_date ? new Date(snap.birth_date) : null,
              total_balance: parseFloat(snap.total_balance),
              remaining_balance: parseFloat(snap.remaining_balance),
              status: snap.status as "ACTIVE" | "FINISHED" | "SUSPENDED",
            },
          });
          autoRevertedCount++;
        }

        autoRollbackResult = ` | تراجع تلقائي: حذف ${autoDeletedCount}، استعادة ${autoRestoredCount}، ارجاع ${autoRevertedCount}`;
      } catch (rollbackError) {
        autoRollbackResult = ` | فشل التراجع التلقائي: ${rollbackError instanceof Error ? rollbackError.message : "خطأ غير معروف"}`;
      }
    }

    const failedJob = await prisma.importJob.update({
      where: { id: currentJob.id },
      data: {
        status: "FAILED",
        error_message: message + autoRollbackResult,
        skipped_rows_report: skippedRows.length > 0 ? toJsonValue(skippedRows) : Prisma.JsonNull,
        rollback_data: partialRollbackData,
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

  let skippedRows: SkippedImportRowReport[] = [];
  if (Array.isArray(job.skipped_rows_report)) {
    skippedRows = job.skipped_rows_report as unknown as SkippedImportRowReport[];
  } else if (job.skipped_rows_report && typeof job.skipped_rows_report === "object" && "rows" in job.skipped_rows_report) {
    skippedRows = (job.skipped_rows_report as Record<string, unknown>).rows as SkippedImportRowReport[];
  }

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

// ─── التراجع عن الاستيراد ─────────────────────────────────────────
type RollbackData = {
  createdIds: string[];
  restoredIds: string[];
  beforeSnapshots: Array<{
    id: string;
    name: string;
    birth_date: string | null;
    total_balance: string;
    remaining_balance: string;
    status: string;
    deleted_at: string | null;
  }>;
};

export async function rollbackImportJob(jobId: string, username: string) {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, created_by: username, status: "COMPLETED" },
    select: { id: true, rollback_data: true },
  });

  if (!job) {
    return { error: "لم يتم العثور على المهمة أو لا يمكن التراجع عنها." };
  }

  if (!job.rollback_data || typeof job.rollback_data !== "object") {
    return { error: "لا توجد بيانات تراجع لهذه المهمة." };
  }

  const data = job.rollback_data as unknown as RollbackData;
  const createdIds = Array.isArray(data.createdIds) ? data.createdIds : [];
  const restoredIds = Array.isArray(data.restoredIds) ? data.restoredIds : [];
  const beforeSnapshots = Array.isArray(data.beforeSnapshots) ? data.beforeSnapshots : [];

  let deletedCount = 0;
  let restoredCount = 0;
  let revertedCount = 0;

  try {
    // 1. حذف المستفيدين الذين أُنشئوا بالاستيراد (soft delete)
    if (createdIds.length > 0) {
      const result = await prisma.beneficiary.updateMany({
        where: { id: { in: createdIds }, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      deletedCount = result.count;
    }

    // 2. استعادة الحالة السابقة للسجلات المُستعادة من soft-delete
    if (restoredIds.length > 0) {
      for (const snap of beforeSnapshots.filter((s) => restoredIds.includes(s.id))) {
        await prisma.beneficiary.update({
          where: { id: snap.id },
          data: {
            name: snap.name,
            birth_date: snap.birth_date ? new Date(snap.birth_date) : null,
            total_balance: parseFloat(snap.total_balance),
            remaining_balance: parseFloat(snap.remaining_balance),
            status: snap.status as "ACTIVE" | "FINISHED" | "SUSPENDED",
            deleted_at: snap.deleted_at ? new Date(snap.deleted_at) : null,
          },
        });
        restoredCount++;
      }
    }

    // 3. استعادة الحالة السابقة للسجلات المُحدَّثة
    const updatedSnapshots = beforeSnapshots.filter((s) => !restoredIds.includes(s.id));
    for (const snap of updatedSnapshots) {
      await prisma.beneficiary.update({
        where: { id: snap.id },
        data: {
          name: snap.name,
          birth_date: snap.birth_date ? new Date(snap.birth_date) : null,
          total_balance: parseFloat(snap.total_balance),
          remaining_balance: parseFloat(snap.remaining_balance),
          status: snap.status as "ACTIVE" | "FINISHED" | "SUSPENDED",
        },
      });
      revertedCount++;
    }

    // 4. تحديث حالة المهمة
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "ROLLED_BACK",
        error_message: `تم التراجع: حذف ${deletedCount}، إعادة ${restoredCount} لحالة الحذف، استعادة ${revertedCount} سجل`,
      },
    });

    // 5. سجل التدقيق
    const facility = await prisma.facility.findUnique({
      where: { username },
      select: { id: true },
    });
    await prisma.auditLog.create({
      data: {
        facility_id: facility?.id ?? undefined,
        user: username,
        action: "ROLLBACK_IMPORT",
        metadata: {
          jobId: job.id,
          deletedCount,
          restoredCount,
          revertedCount,
        },
      },
    });

    try {
      revalidatePath("/dashboard");
      revalidatePath("/import");
      revalidatePath("/beneficiaries");
    } catch {
      // revalidate غير متاح خارج سياق الطلب
    }

    return { success: true, deletedCount, restoredCount, revertedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "حدث خطأ أثناء التراجع.";
    return { error: message };
  }
}