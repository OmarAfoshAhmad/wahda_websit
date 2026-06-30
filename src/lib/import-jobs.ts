import { Prisma, ImportJobStatus } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { normalizeCardNumber, canonicalizeCardNumber, personKey } from "@/lib/normalize";
import { ensureCardNumberAvailability } from "@/app/actions/beneficiary/utils";

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
  wipeInactive?: boolean;
  company_id?: string; // شركة التأمين المستهدفة (للاستيراد من بوابة الأسنان)
};

type NormalizedImportRow = {
  card_number: string;
  name: string;
  birth_date: Date | null;
  status: "ACTIVE" | "SUSPENDED" | null;
};

type PreparedImportRow = {
  data: NormalizedImportRow;
  rawRow: Record<string, unknown>;
  rowNumber: number | null;
};

type SkippedImportReason = "invalid_row" | "missing_required_fields" | "duplicate_in_file" | "already_exists" | "duplicate_person" | "excluded_deceased_appendix" | "invalid_company_pattern";

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
    case "excluded_deceased_appendix":
      return "تم الاستبعاد (ملحق أو متوفي)";
    case "invalid_company_pattern":
      return "رقم البطاقة لا يطابق الشركة المحددة";
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

  const cardNumber = normalizeString(getField(parsed.data, "card_number", "رقم البطاقة", "رقم_البطاقة", "الرقم", "رقم_بطاقة", "الرقم الوظيفي", "لرقم الوظيفي", "رقم الموظف", "ر.م", "insurance profile", "Insurance Profile")).toUpperCase();
  const name = normalizeString(getField(parsed.data, "name", "الاسم", "الإسم", "اسم المستفيد", "اسم_المستفيد", "employee name", "Employee Name"));

  if (!cardNumber || !name) {
    return { error: "missing_required_fields" };
  }

  // التحقق من الكلمات المستبعدة (ملحق أو متوفي)
  const statusVal = normalizeString(getField(parsed.data, "status", "الحالة", "الوضع", "الوضعية", "Statue"));
  const relVal = normalizeString(getField(parsed.data, "relationship", "صلة القرابة", "الصلة", "صلة"));
  
  const isExcluded = 
    name.includes("متوفي") || name.includes("متوفى") || name.includes("وفاة") || name.includes("ملحق") ||
    statusVal.includes("متوفي") || statusVal.includes("متوفى") || statusVal.includes("وفاة") || statusVal.includes("ملحق") ||
    relVal.includes("متوفي") || relVal.includes("متوفى") || relVal.includes("وفاة") || relVal.includes("ملحق");

  if (isExcluded) {
    return { error: "excluded_deceased_appendix" };
  }

  // تم الغاء حقن تاريخ الميلاد من الاستيرادات العامة بناء على طلب المستخدم
  // const birthDateValue = extractBirthDate(parsed.data);
  // const birthDate = parseBirthDate(birthDateValue);
  const birthDate = null;

  let parsedStatus: "ACTIVE" | "SUSPENDED" | null = null;
  if (statusVal) {
    const normalized = statusVal.trim().toLowerCase();
    if (normalized.includes("موقوف") || normalized.includes("موقف") || normalized.includes("suspend") || normalized.includes("inactive")) {
      parsedStatus = "SUSPENDED";
    } else if (normalized.includes("نشط") || normalized.includes("active")) {
      parsedStatus = "ACTIVE";
    }
  }

  return {
    data: {
      card_number: cardNumber,
      name,
      birth_date: birthDate,
      status: parsedStatus,
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

  // جلب جميع شركات التأمين النشطة
  const activeCompanies = await prisma.insuranceCompany.findMany({
    where: { is_active: true, deleted_at: null },
    include: { service_policies: { include: { service_type: true } } }
  });

  const matchCompanyForCard = (
    cardNumber: string,
    companies: typeof activeCompanies
  ) => {
    const upper = cardNumber.toUpperCase().trim();
    for (const company of companies) {
      if (!company.card_pattern) continue;
      try {
        const regex = new RegExp(company.card_pattern);
        if (regex.test(upper)) {
          return company;
        }
      } catch (e) {
        continue;
      }
    }
    for (const company of companies) {
      if (company.card_pattern && upper.startsWith(company.code)) {
        return company;
      }
    }
    return null;
  };

  const getPolicyCeiling = (company: typeof activeCompanies[number]) => {
    const dentalPolicy = (company as any).service_policies?.find((p: any) => p.service_type?.code === "DENTAL");
    if (dentalPolicy && dentalPolicy.ceiling_amount !== null) {
      return Number(dentalPolicy.ceiling_amount);
    }
    if (company.general_ceiling !== null) {
      return Number(company.general_ceiling);
    }
    if (company.medicine_ceiling !== null) {
      return Number(company.medicine_ceiling);
    }
    return null;
  };

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
    wipeInactive: false,
  };
  if (currentJob.options && typeof currentJob.options === "object" && !Array.isArray(currentJob.options)) {
    const rawOpts = currentJob.options as Record<string, unknown>;
    if (rawOpts.updateBalance === true) opts.updateBalance = true;
    if (rawOpts.reactivate === true) opts.reactivate = true;
    if (rawOpts.wipeInactive === true) opts.wipeInactive = true;
    if (typeof rawOpts.company_id === "string" && rawOpts.company_id) opts.company_id = rawOpts.company_id;
  }

  // بيانات التراجع
  const rollbackCreatedIds: string[] = [];
  const rollbackBeforeSnapshots: Array<{
    id: string;
    card_number: string;
    name: string;
    birth_date: string | null;
    is_legacy_card: boolean;
    total_balance: string;
    remaining_balance: string;
    status: string;
    deleted_at: string | null;
  }> = [];
  const rollbackRestoredIds: string[] = []; // IDs of soft-deleted records that were restored

  try {
    if (opts.wipeInactive) {
      await prisma.beneficiary.updateMany({
        where: {
          deleted_at: null,
          ...(opts.company_id ? { company_id: opts.company_id } : {}),
          transactions: { none: {} },
          claims: { none: {} },
          wallet_consumptions: { none: {} },
        },
        data: {
          deleted_at: new Date(),
        },
      });
    }

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

      if (opts.company_id) {
        const selectedCompany = activeCompanies.find(c => c.id === opts.company_id);
        if (selectedCompany && matchCompanyForCard(normalized.data.card_number, [selectedCompany]) === null) {
          failedRows += 1;
          processedRows += 1;
          skippedRows.push(createSkippedRowReport({
            reason: "invalid_company_pattern",
            rowNumber,
            rawRow,
            normalized: normalized.data,
          }));
          continue;
        }
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
      const normalizedCardNumbers = [...new Set(chunk.map((row) => normalizeCardNumber(row.data.card_number)))];
      const canonicalChunkCards = [...new Set(chunk.map((row) => canonicalizeCardNumber(row.data.card_number)))];
      const chunkCanonicalSet = new Set(canonicalChunkCards);

      // البحث عن المستفيدين النشطين والمحذوفين معيارياً لتجنب التكرار ببادئة الأصفار
      const candidatesActive = await prisma.beneficiary.findMany({
        where: {
          deleted_at: null,
          OR: [
            { card_number: { startsWith: "WAB2025", mode: "insensitive" } },
            { card_number: { in: normalizedCardNumbers, mode: "insensitive" } }
          ]
        },
        select: {
          id: true,
          card_number: true,
          name: true,
          birth_date: true,
          is_legacy_card: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          company_id: true,
          _count: {
            select: {
              transactions: true,
              claims: true,
              wallet_consumptions: true
            }
          }
        }
      });

      const candidatesDeleted = await prisma.beneficiary.findMany({
        where: {
          deleted_at: { not: null },
          OR: [
            { card_number: { startsWith: "WAB2025", mode: "insensitive" } },
            { card_number: { in: normalizedCardNumbers, mode: "insensitive" } }
          ]
        },
        select: {
          id: true,
          card_number: true,
          name: true,
          birth_date: true,
          is_legacy_card: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          deleted_at: true,
          company_id: true,
          _count: {
            select: {
              transactions: true,
              claims: true,
              wallet_consumptions: true
            }
          }
        }
      });

      const matchedActive = candidatesActive.filter(b => chunkCanonicalSet.has(canonicalizeCardNumber(b.card_number)));
      const matchedDeleted = candidatesDeleted.filter(b => chunkCanonicalSet.has(canonicalizeCardNumber(b.card_number)));

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
            id: true,
            card_number: true,
            name: true,
            birth_date: true,
            is_legacy_card: true,
            total_balance: true,
            remaining_balance: true,
            status: true,
            company_id: true,
          },
        })
        : [];

      const existingPersonKeys = new Set(
        existingPersons
          .map((row) => personKey(row.name, row.birth_date))
          .filter((key): key is string => Boolean(key))
      );

      const personKeyToActiveRows = new Map<string, typeof existingPersons>();
      for (const row of existingPersons) {
        const key = personKey(row.name, row.birth_date);
        if (!key) continue;
        const arr = personKeyToActiveRows.get(key) ?? [];
        arr.push(row);
        personKeyToActiveRows.set(key, arr);
      }

      // فرز وتصنيف الصفوف بحسب التطابق المعياري
      const resolvedInserts: typeof chunk = [];
      const resolvedUpdates: Array<{ row: typeof chunk[0]; activeRow: typeof matchedActive[0] }> = [];
      const resolvedRestores: Array<{ row: typeof chunk[0]; deletedRow: typeof matchedDeleted[0] }> = [];
      const resolvedFixCards: Array<{ row: typeof chunk[0]; targetRow: typeof existingPersons[0] }> = [];

      for (const row of chunk) {
        const rowCanonical = canonicalizeCardNumber(row.data.card_number);
        const rowNormalized = normalizeCardNumber(row.data.card_number);

        const activeMatches = matchedActive.filter(b => canonicalizeCardNumber(b.card_number) === rowCanonical);
        const deletedMatches = matchedDeleted.filter(b => canonicalizeCardNumber(b.card_number) === rowCanonical);

        if (activeMatches.length > 0) {
          // وجود تكرار: نقوم بالإبقاء على المستفيد صاحب الحركات، ونقوم بتحديث رقم بطاقته للجديد المعتمد بالإكسيل ومسح الباقين
          let keep = null;
          const hasTx = activeMatches.filter(b => (b._count.transactions + b._count.claims + b._count.wallet_consumptions) > 0);
          
          if (hasTx.length === 1) {
            keep = hasTx[0];
          } else if (hasTx.length > 1) {
            keep = hasTx.sort((a, b) => {
              const aCount = a._count.transactions + a._count.claims + a._count.wallet_consumptions;
              const bCount = b._count.transactions + b._count.claims + b._count.wallet_consumptions;
              return bCount - aCount;
            })[0];
          } else {
            const exactMatch = activeMatches.find(b => normalizeCardNumber(b.card_number) === rowNormalized);
            keep = exactMatch || activeMatches[0];
          }

          // مسح الحسابات المكررة الصفرية (التي لا تحتوي على أي حركات)
          const deleteList = activeMatches.filter(b => b.id !== keep.id);
          if (deleteList.length > 0) {
            for (const d of deleteList) {
              const newCardName = `${d.card_number}_DEL_${Date.now()}_${d.id.slice(-4)}`;
              await prisma.beneficiary.update({
                where: { id: d.id },
                data: {
                  deleted_at: new Date(),
                  card_number: newCardName
                }
              });
            }
            // إزالتهم من المصفوفتين حتى لا يتم رصدهم مجدداً في باقي الحلقة
            for (const d of deleteList) {
              const idx = matchedActive.findIndex(b => b.id === d.id);
              if (idx !== -1) matchedActive.splice(idx, 1);
            }
          }

          resolvedUpdates.push({ row, activeRow: keep });
        } else if (deletedMatches.length > 0) {
          // استعادة محذوف
          resolvedRestores.push({ row, deletedRow: deletedMatches[0] });
        } else {
          // فحص تطابق الاسم والميلاد لتصحيح البطاقة
          const pKey = personKey(row.data.name, row.data.birth_date);
          const matches = pKey ? (personKeyToActiveRows.get(pKey) ?? []) : [];
          if (pKey && matches.length === 1) {
            resolvedFixCards.push({ row, targetRow: matches[0] });
          } else {
            if (pKey && existingPersonKeys.has(pKey) && matches.length !== 1) {
              skippedRows.push(createSkippedRowReport({
                reason: "duplicate_person",
                rowNumber: row.rowNumber,
                rawRow: row.rawRow,
                normalized: row.data,
              }));
              duplicateRows += 1;
              processedRows += 1;
            } else {
              resolvedInserts.push(row);
            }
          }
        }
      }

      processedRows += chunk.length;

      // 1. إدراج المستفيدين الجدد
      if (resolvedInserts.length > 0) {
        const result = await prisma.beneficiary.createMany({
          data: resolvedInserts.map((row) => {
            const cn = normalizeCardNumber(row.data.card_number);
            let rowCompanyId = opts.company_id || null;
            let balance = initialBalance;

            if (!rowCompanyId) {
              const matchedComp = matchCompanyForCard(cn, activeCompanies);
              if (matchedComp) {
                rowCompanyId = matchedComp.id;
                const ceiling = getPolicyCeiling(matchedComp);
                if (ceiling !== null) {
                  balance = ceiling;
                }
              }
            } else {
              const comp = activeCompanies.find(c => c.id === rowCompanyId);
              if (comp) {
                const ceiling = getPolicyCeiling(comp);
                if (ceiling !== null) {
                  balance = ceiling;
                }
              }
            }

            return {
              card_number: row.data.card_number,
              name: row.data.name,
              birth_date: row.data.birth_date,
              total_balance: balance,
              remaining_balance: balance,
              status: (row.data.status ?? "ACTIVE") as "ACTIVE" | "SUSPENDED" | "FINISHED",
              ...(rowCompanyId ? { company_id: rowCompanyId } : {}),
            };
          }),
          skipDuplicates: true,
        });
        insertedRows += result.count;
        duplicateRows += resolvedInserts.length - result.count;

        if (result.count > 0) {
          const newlyCreated = await prisma.beneficiary.findMany({
            where: {
              card_number: { in: resolvedInserts.map((r) => r.data.card_number), mode: "insensitive" },
              deleted_at: null,
            },
            select: { id: true },
          });
          rollbackCreatedIds.push(...newlyCreated.map((r) => r.id));
        }
      }

      // 2. استعادة السجلات المحذوفة
      if (resolvedRestores.length > 0) {
        for (const { row, deletedRow } of resolvedRestores) {
          const cn = normalizeCardNumber(row.data.card_number);

          rollbackBeforeSnapshots.push({
            id: deletedRow.id,
            card_number: deletedRow.card_number,
            name: deletedRow.name,
            birth_date: deletedRow.birth_date?.toISOString() ?? null,
            is_legacy_card: Boolean((deletedRow as unknown as Record<string, unknown>).is_legacy_card),
            total_balance: String(deletedRow.total_balance),
            remaining_balance: String(deletedRow.remaining_balance),
            status: deletedRow.status,
            deleted_at: deletedRow.deleted_at?.toISOString() ?? null,
          });

          let rowCompanyId = opts.company_id || deletedRow.company_id || null;
          let balance = initialBalance;

          if (!rowCompanyId) {
            const matchedComp = matchCompanyForCard(cn, activeCompanies);
            if (matchedComp) {
              rowCompanyId = matchedComp.id;
              const ceiling = getPolicyCeiling(matchedComp);
              if (ceiling !== null) {
                balance = ceiling;
              }
            }
          } else {
            const comp = activeCompanies.find(c => c.id === rowCompanyId);
            if (comp) {
              const ceiling = getPolicyCeiling(comp);
              if (ceiling !== null) {
                balance = ceiling;
              }
            }
          }

          const targetStatus = row.data.status
            ? row.data.status
            : (opts.reactivate ? "ACTIVE" : deletedRow.status);

          await ensureCardNumberAvailability(prisma, row.data.card_number, deletedRow.id);

          await prisma.beneficiary.update({
            where: { id: deletedRow.id },
            data: {
              deleted_at: null,
              card_number: row.data.card_number, // تحديث رقم البطاقة للتنسيق المعتمد بالإكسيل
              name: row.data.name,
              birth_date: row.data.birth_date,
              status: targetStatus as "ACTIVE" | "SUSPENDED" | "FINISHED",
              ...(rowCompanyId ? { company_id: rowCompanyId } : {}),
              ...(opts.updateBalance ? {
                total_balance: balance,
                remaining_balance: balance,
              } : {}),
            },
          });
          rollbackRestoredIds.push(deletedRow.id);
        }
        insertedRows += resolvedRestores.length;
      }

      // 3. تحديث السجلات النشطة (أو تعديل الأصفار البادئة للبطاقة)
      if (resolvedUpdates.length > 0) {
        let successfulUpdates = 0;
        for (const { row, activeRow } of resolvedUpdates) {
          const cn = normalizeCardNumber(row.data.card_number);

          rollbackBeforeSnapshots.push({
            id: activeRow.id,
            card_number: activeRow.card_number,
            name: activeRow.name,
            birth_date: activeRow.birth_date?.toISOString() ?? null,
            is_legacy_card: Boolean((activeRow as unknown as Record<string, unknown>).is_legacy_card),
            total_balance: String(activeRow.total_balance),
            remaining_balance: String(activeRow.remaining_balance),
            status: activeRow.status,
            deleted_at: null,
          });

          let rowCompanyId = opts.company_id || activeRow.company_id || null;
          let balance = initialBalance;

          if (!rowCompanyId) {
            const matchedComp = matchCompanyForCard(cn, activeCompanies);
            if (matchedComp) {
              rowCompanyId = matchedComp.id;
              const ceiling = getPolicyCeiling(matchedComp);
              if (ceiling !== null) {
                balance = ceiling;
              }
            }
          } else {
            const comp = activeCompanies.find(c => c.id === rowCompanyId);
            if (comp) {
              const ceiling = getPolicyCeiling(comp);
              if (ceiling !== null) {
                balance = ceiling;
              }
            }
          }

          const targetStatus = row.data.status
            ? row.data.status
            : (opts.reactivate ? "ACTIVE" : activeRow.status);

          await ensureCardNumberAvailability(prisma, row.data.card_number, activeRow.id);

          const updateData: Record<string, any> = {
            card_number: row.data.card_number, // تحديث رقم البطاقة للتنسيق المعتمد بالإكسيل
            name: row.data.name,
            birth_date: row.data.birth_date,
            status: targetStatus,
            ...(rowCompanyId ? { company_id: rowCompanyId } : {}),
          };

          if (opts.updateBalance) {
            updateData.total_balance = balance;
            updateData.remaining_balance = balance;
          }

          await prisma.beneficiary.update({
            where: { id: activeRow.id },
            data: updateData,
          });
          successfulUpdates++;
        }
        updatedRows += successfulUpdates;
      }

      // 4. تصحيح البطاقة بالاسم والميلاد إذا كانت مختلفة
      if (resolvedFixCards.length > 0) {
        let successfulCardFixes = 0;
        for (const { row, targetRow } of resolvedFixCards) {
          rollbackBeforeSnapshots.push({
            id: targetRow.id,
            card_number: targetRow.card_number,
            name: targetRow.name,
            birth_date: targetRow.birth_date?.toISOString() ?? null,
            is_legacy_card: Boolean((targetRow as unknown as Record<string, unknown>).is_legacy_card),
            total_balance: String(targetRow.total_balance),
            remaining_balance: String(targetRow.remaining_balance),
            status: targetRow.status,
            deleted_at: null,
          });

          const cn = normalizeCardNumber(row.data.card_number);
          let rowCompanyId = opts.company_id || targetRow.company_id || null;
          let balance = initialBalance;

          if (!rowCompanyId) {
            const matchedComp = matchCompanyForCard(cn, activeCompanies);
            if (matchedComp) {
              rowCompanyId = matchedComp.id;
              const ceiling = getPolicyCeiling(matchedComp);
              if (ceiling !== null) {
                balance = ceiling;
              }
            }
          } else {
            const comp = activeCompanies.find(c => c.id === rowCompanyId);
            if (comp) {
              const ceiling = getPolicyCeiling(comp);
              if (ceiling !== null) {
                balance = ceiling;
              }
            }
          }

          const targetStatus = row.data.status
            ? row.data.status
            : (opts.reactivate ? "ACTIVE" : targetRow.status);

          await ensureCardNumberAvailability(prisma, row.data.card_number, targetRow.id);

          const updateData: Record<string, any> = {
            card_number: row.data.card_number,
            name: row.data.name,
            birth_date: row.data.birth_date,
            status: targetStatus,
            ...(rowCompanyId ? { company_id: rowCompanyId } : {}),
          };

          if (opts.updateBalance) {
            updateData.total_balance = balance;
            updateData.remaining_balance = balance;
          }

          await prisma.beneficiary.update({
            where: { id: targetRow.id },
            data: updateData,
          });

          successfulCardFixes++;
        }

        updatedRows += successfulCardFixes;
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
              card_number: snap.card_number,
              name: snap.name,
              birth_date: snap.birth_date ? new Date(snap.birth_date) : null,
              is_legacy_card: Boolean((snap as Record<string, unknown>).is_legacy_card),
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
              card_number: snap.card_number,
              name: snap.name,
              birth_date: snap.birth_date ? new Date(snap.birth_date) : null,
              is_legacy_card: Boolean((snap as Record<string, unknown>).is_legacy_card),
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
      inserted_rows: true,
      duplicate_rows: true,
      failed_rows: true,
      skipped_rows_report: true,
      rollback_data: true,
    },
  });

  if (!job) {
    return null;
  }

  let skippedRows: SkippedImportRowReport[] = [];
  let updatedRowsCount = 0;
  if (Array.isArray(job.skipped_rows_report)) {
    skippedRows = job.skipped_rows_report as unknown as SkippedImportRowReport[];
  } else if (job.skipped_rows_report && typeof job.skipped_rows_report === "object" && "rows" in job.skipped_rows_report) {
    skippedRows = (job.skipped_rows_report as Record<string, unknown>).rows as SkippedImportRowReport[];
    const maybeUpdatedRows = (job.skipped_rows_report as Record<string, unknown>).updatedRows;
    if (typeof maybeUpdatedRows === "number") {
      updatedRowsCount = maybeUpdatedRows;
    }
  }

  const rollback = (job.rollback_data && typeof job.rollback_data === "object")
    ? (job.rollback_data as {
      createdIds?: string[];
      restoredIds?: string[];
      beforeSnapshots?: Array<{
        id: string;
        card_number: string;
        name: string;
        birth_date: string | null;
        is_legacy_card: boolean;
        total_balance: string;
        remaining_balance: string;
        status: string;
        deleted_at: string | null;
      }>;
    })
    : {};

  const createdIds = Array.isArray(rollback.createdIds) ? rollback.createdIds : [];
  const restoredIds = Array.isArray(rollback.restoredIds) ? rollback.restoredIds : [];
  const beforeSnapshots = Array.isArray(rollback.beforeSnapshots) ? rollback.beforeSnapshots : [];

  const importedIds = [...new Set([...createdIds, ...restoredIds])];
  const updatedIds = [...new Set(beforeSnapshots.map((s) => s.id).filter((id) => !restoredIds.includes(id)))];
  const impactedIds = [...new Set([...importedIds, ...updatedIds])];

  const hasSummaryEvidence =
    (job.inserted_rows ?? 0) > 0
    || updatedRowsCount > 0
    || (job.duplicate_rows ?? 0) > 0
    || (job.failed_rows ?? 0) > 0;

  if (skippedRows.length === 0 && importedIds.length === 0 && updatedIds.length === 0 && !hasSummaryEvidence) {
    return { empty: true as const };
  }

  const currentRows = impactedIds.length > 0
    ? await prisma.beneficiary.findMany({
      where: { id: { in: impactedIds } },
      select: {
        id: true,
        card_number: true,
        name: true,
        birth_date: true,
        total_balance: true,
        remaining_balance: true,
        status: true,
      },
    })
    : [];
  const currentById = new Map(currentRows.map((r) => [r.id, r]));
  const beforeById = new Map(beforeSnapshots.map((s) => [s.id, s]));

  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet("الملخص");
  summary.views = [{ rightToLeft: true }];
  summary.columns = [
    { header: "البيان", key: "label", width: 28 },
    { header: "القيمة", key: "value", width: 18 },
  ];
  summary.getRow(1).font = { bold: true, size: 12 };
  summary.addRow({ label: "رقم المهمة", value: job.id });
  summary.addRow({ label: "إجمالي المدخلين", value: importedIds.length || job.inserted_rows || 0 });
  summary.addRow({ label: "إجمالي المحدّثين", value: updatedRowsCount || updatedIds.length });
  summary.addRow({ label: "إجمالي الفاشلين/المتخطين", value: skippedRows.length || ((job.duplicate_rows ?? 0) + (job.failed_rows ?? 0)) });

  const insertedSheet = workbook.addWorksheet("الذين دخلوا");
  insertedSheet.views = [{ rightToLeft: true }];
  insertedSheet.columns = [
    { header: "#", key: "index", width: 8 },
    { header: "النوع", key: "importType", width: 16 },
    { header: "المعرف", key: "id", width: 30 },
    { header: "رقم البطاقة", key: "card_number", width: 22 },
    { header: "الاسم", key: "name", width: 32 },
    { header: "تاريخ الميلاد", key: "birth_date", width: 16 },
    { header: "الرصيد الكلي", key: "total_balance", width: 16 },
    { header: "الرصيد المتبقي", key: "remaining_balance", width: 16 },
    { header: "الحالة", key: "status", width: 14 },
  ];
  insertedSheet.getRow(1).font = { bold: true, size: 12 };
  insertedSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  importedIds.forEach((id, idx) => {
    const current = currentById.get(id);
    insertedSheet.addRow({
      index: idx + 1,
      importType: restoredIds.includes(id) ? "مستعاد" : "جديد",
      id,
      card_number: current?.card_number ?? "-",
      name: current?.name ?? "-",
      birth_date: current?.birth_date ? current.birth_date.toISOString().slice(0, 10) : "-",
      total_balance: current ? Number(current.total_balance) : "-",
      remaining_balance: current ? Number(current.remaining_balance) : "-",
      status: current?.status ?? "-",
    });
  });

  if (importedIds.length === 0 && (job.inserted_rows ?? 0) > 0) {
    insertedSheet.addRow({
      index: 1,
      importType: "ملخص فقط",
      id: "-",
      card_number: "-",
      name: "لا تتوفر تفاصيل صفية لهذه المهمة (تم الاحتفاظ بالعداد فقط)",
      birth_date: "-",
      total_balance: "-",
      remaining_balance: "-",
      status: "-",
    });
  }

  const updatedSheet = workbook.addWorksheet("المحدثون قبل وبعد");
  updatedSheet.views = [{ rightToLeft: true }];
  updatedSheet.columns = [
    { header: "#", key: "index", width: 8 },
    { header: "المعرف", key: "id", width: 30 },
    { header: "البطاقة قبل", key: "before_card", width: 22 },
    { header: "البطاقة بعد", key: "after_card", width: 22 },
    { header: "الاسم قبل", key: "before_name", width: 30 },
    { header: "الاسم بعد", key: "after_name", width: 30 },
    { header: "الميلاد قبل", key: "before_birth", width: 16 },
    { header: "الميلاد بعد", key: "after_birth", width: 16 },
    { header: "المتبقي قبل", key: "before_remaining", width: 16 },
    { header: "المتبقي بعد", key: "after_remaining", width: 16 },
    { header: "الحالة قبل", key: "before_status", width: 14 },
    { header: "الحالة بعد", key: "after_status", width: 14 },
  ];
  updatedSheet.getRow(1).font = { bold: true, size: 12 };
  updatedSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  updatedIds.forEach((id, idx) => {
    const before = beforeById.get(id);
    const current = currentById.get(id);
    updatedSheet.addRow({
      index: idx + 1,
      id,
      before_card: before?.card_number ?? "-",
      after_card: current?.card_number ?? "-",
      before_name: before?.name ?? "-",
      after_name: current?.name ?? "-",
      before_birth: before?.birth_date ? before.birth_date.slice(0, 10) : "-",
      after_birth: current?.birth_date ? current.birth_date.toISOString().slice(0, 10) : "-",
      before_remaining: before ? Number(before.remaining_balance) : "-",
      after_remaining: current ? Number(current.remaining_balance) : "-",
      before_status: before?.status ?? "-",
      after_status: current?.status ?? "-",
    });
  });

  if (updatedIds.length === 0 && updatedRowsCount > 0) {
    updatedSheet.addRow({
      index: 1,
      id: "-",
      before_card: "-",
      after_card: "-",
      before_name: "لا تتوفر تفاصيل قبل/بعد لهذه المهمة (تم الاحتفاظ بعدد التحديثات فقط)",
      after_name: "-",
      before_birth: "-",
      after_birth: "-",
      before_remaining: "-",
      after_remaining: "-",
      before_status: "-",
      after_status: "-",
    });
  }

  const worksheet = workbook.addWorksheet("الذين فشل دخولهم");
  worksheet.views = [{ rightToLeft: true }];
  const dynamicKeys = Array.from(new Set(skippedRows.flatMap((row) => Object.keys(row.rawRow ?? {}))));

  worksheet.columns = [
    { header: "#", key: "index", width: 8 },
    { header: "رقم الصف", key: "rowNumber", width: 12 },
    { header: "سبب عدم الاستيراد", key: "reasonLabel", width: 28 },
    { header: "رقم البطاقة", key: "card_number", width: 20 },
    { header: "الاسم", key: "name", width: 28 },
    { header: "تاريخ الميلاد", key: "birth_date", width: 18 },
    ...dynamicKeys.map((key) => ({ header: key, key: `raw:${key}`, width: 24 })),
  ];

  skippedRows.forEach((row, idx) => {
    const sheetRow: Record<string, unknown> = {
      index: idx + 1,
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
  headerRow.font = { bold: true, size: 12 };
  headerRow.alignment = { horizontal: "center" };

  const buffer = await workbook.xlsx.writeBuffer();
  const datePart = job.created_at.toISOString().slice(0, 10);

  return {
    empty: false as const,
    buffer: Buffer.from(buffer),
    fileName: `import-report-${job.id}-${datePart}.xlsx`,
  };
}

// ─── التراجع عن الاستيراد ─────────────────────────────────────────
type RollbackData = {
  createdIds: string[];
  restoredIds: string[];
  beforeSnapshots: Array<{
    id: string;
    card_number: string;
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
            card_number: snap.card_number,
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
          card_number: snap.card_number,
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