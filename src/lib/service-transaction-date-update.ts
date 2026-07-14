import type { TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";

export type ServiceTransactionDateUpdateRow = {
  rowNumber: number;
  name: string;
  card: string;
  approval: string;
  amount: number;
  date: Date;
  facilityName: string;
};

export type ServiceTransactionDateUpdateIssue = {
  rowNumber: number;
  name: string;
  card: string;
  facilityName: string;
  amount: number;
  reason: string;
};

export type ServiceTransactionDateUpdateResult = {
  updatedCount: number;
  alreadyCorrectCount: number;
  missingCount: number;
  conflictCount: number;
  issues: ServiceTransactionDateUpdateIssue[];
};

type UpdateOptions = {
  rows: ServiceTransactionDateUpdateRow[];
  transactionType: TransactionType;
  keyPrefix: string;
  companyId: string;
  actorId: string;
  actorUsername: string;
  sourceFileName?: string;
  dryRun: boolean;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeCard(value: unknown): string {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function keyCard(value: unknown): string {
  return clean(value).toUpperCase();
}

function amountKey(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value);
}

export function dateOnlyIso(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function importedTransactionStablePrefix(
  keyPrefix: string,
  row: Pick<ServiceTransactionDateUpdateRow, "rowNumber" | "card" | "amount">,
): string {
  return `${keyPrefix}:${row.rowNumber}:${keyCard(row.card)}:${amountKey(row.amount)}:`;
}

export function importedTransactionKey(
  keyPrefix: string,
  row: Pick<ServiceTransactionDateUpdateRow, "rowNumber" | "card" | "amount" | "date">,
): string {
  return `${importedTransactionStablePrefix(keyPrefix, row)}${dateOnlyIso(row.date)}`;
}

function issue(row: ServiceTransactionDateUpdateRow, reason: string): ServiceTransactionDateUpdateIssue {
  return {
    rowNumber: row.rowNumber,
    name: row.name,
    card: row.card,
    facilityName: row.facilityName,
    amount: row.amount,
    reason,
  };
}

export async function updateImportedServiceTransactionDates(
  options: UpdateOptions,
): Promise<ServiceTransactionDateUpdateResult> {
  const invalidReferenceRows = options.rows.filter((row) => !row.card || !dateOnlyIso(row.date));
  const rows = options.rows.filter((row) => row.card && dateOnlyIso(row.date));
  const stablePrefixes = rows.map((row) => importedTransactionStablePrefix(options.keyPrefix, row));
  const duplicatePrefixes = stablePrefixes.filter((prefix, index) => stablePrefixes.indexOf(prefix) !== index);
  if (duplicatePrefixes.length > 0) {
    throw new Error("الملف يحتوي على مراجع حركة مكررة بالصف والبطاقة والمبلغ، ولا يمكن تحديث التاريخ بأمان.");
  }

  const existing = stablePrefixes.length
    ? await prisma.transaction.findMany({
        where: {
          type: options.transactionType,
          company_id: options.companyId,
          OR: stablePrefixes.map((prefix) => ({ idempotency_key: { startsWith: prefix } })),
        },
        select: {
          id: true,
          amount: true,
          created_at: true,
          idempotency_key: true,
          beneficiary: { select: { card_number: true, name: true } },
        },
      })
    : [];

  const byPrefix = new Map<string, typeof existing>();
  for (const prefix of stablePrefixes) byPrefix.set(prefix, []);
  for (const transaction of existing) {
    const key = transaction.idempotency_key ?? "";
    const prefix = stablePrefixes.find((candidate) => key.startsWith(candidate));
    if (prefix) byPrefix.get(prefix)?.push(transaction);
  }

  const allKeys = new Map(existing.map((transaction) => [transaction.idempotency_key, transaction.id]));
  const ready: Array<{
    row: ServiceTransactionDateUpdateRow;
    transaction: (typeof existing)[number];
    oldDate: string;
    newDate: string;
    oldKey: string;
    newKey: string;
  }> = [];
  const issues: ServiceTransactionDateUpdateIssue[] = invalidReferenceRows.map((row) =>
    issue(row, !row.card ? "رقم البطاقة فارغ ولا يمكن مطابقة الحركة بأمان" : "التاريخ غير صالح"),
  );
  let alreadyCorrectCount = 0;
  let missingCount = invalidReferenceRows.length;
  let conflictCount = 0;

  for (const row of rows) {
    const prefix = importedTransactionStablePrefix(options.keyPrefix, row);
    const candidates = byPrefix.get(prefix) ?? [];
    if (candidates.length === 0) {
      missingCount += 1;
      issues.push(issue(row, "لم توجد حركة مستوردة سابقة بنفس الصف والبطاقة والمبلغ"));
      continue;
    }
    if (candidates.length > 1) {
      conflictCount += 1;
      issues.push(issue(row, "وجدت أكثر من حركة سابقة تطابق المرجع الثابت؛ أوقف التحديث للمراجعة"));
      continue;
    }

    const transaction = candidates[0];
    const oldKey = transaction.idempotency_key ?? "";
    const newKey = importedTransactionKey(options.keyPrefix, row);
    const oldDate = dateOnlyIso(transaction.created_at);
    const newDate = dateOnlyIso(row.date);
    const transactionCard = normalizeCard(transaction.beneficiary.card_number);
    if (transactionCard !== normalizeCard(row.card) || Number(transaction.amount) !== row.amount) {
      conflictCount += 1;
      issues.push(issue(row, "الحركة المطابقة تختلف في البطاقة أو المبلغ"));
      continue;
    }
    if (oldKey === newKey && oldDate === newDate) {
      alreadyCorrectCount += 1;
      issues.push(issue(row, "التاريخ مسجل بالقيمة الصحيحة مسبقاً"));
      continue;
    }
    const collisionId = allKeys.get(newKey);
    if (collisionId && collisionId !== transaction.id) {
      conflictCount += 1;
      issues.push(issue(row, "مفتاح التاريخ المصحح مستخدم في حركة أخرى"));
      continue;
    }
    ready.push({ row, transaction, oldDate, newDate, oldKey, newKey });
  }

  if (!options.dryRun && (missingCount > 0 || conflictCount > 0)) {
    throw new Error(
      `أوقف تحديث التواريخ: ${missingCount} حركة مفقودة و${conflictCount} حركة متعارضة. أعد المعاينة وراجع التفاصيل.`,
    );
  }

  if (!options.dryRun && ready.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const item of ready) {
        const updated = await tx.transaction.updateMany({
          where: {
            id: item.transaction.id,
            idempotency_key: item.oldKey,
            created_at: item.transaction.created_at,
          },
          data: {
            created_at: new Date(`${item.newDate}T00:00:00.000Z`),
            idempotency_key: item.newKey,
          },
        });
        if (updated.count !== 1) {
          throw new Error(`تغيرت الحركة في الصف ${item.row.rowNumber} بعد المعاينة؛ أعد تحليل الملف.`);
        }
      }

      await tx.auditLog.create({
        data: {
          facility_id: options.actorId,
          user: options.actorUsername,
          action: "UPDATE_IMPORTED_SERVICE_TRANSACTION_DATES",
          metadata: {
            service: options.transactionType,
            sourceFileName: options.sourceFileName || null,
            count: ready.length,
            changes: ready.map((item) => ({
              transactionId: item.transaction.id,
              rowNumber: item.row.rowNumber,
              card: item.row.card,
              beneficiaryName: item.transaction.beneficiary.name,
              amount: item.row.amount,
              oldDate: item.oldDate,
              newDate: item.newDate,
              oldKey: item.oldKey,
              newKey: item.newKey,
            })),
          },
        },
      });
    });
  }

  return {
    updatedCount: ready.length,
    alreadyCorrectCount,
    missingCount,
    conflictCount,
    issues,
  };
}
