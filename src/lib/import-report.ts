"use server";

import { TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";
import { getCurrentInitialBalance } from "@/lib/initial-balance";

function getWaadFacilityId(): string {
  const id = process.env.WAAD_FACILITY_ID;
  if (!id) throw new Error("WAAD_FACILITY_ID env var is not set");
  return id;
}

async function resolveImportFacilityId(username: string): Promise<string> {
  const actorFacility = await prisma.facility.findUnique({
    where: { username },
    select: { id: true },
  });

  if (actorFacility?.id) return actorFacility.id;

  const configuredId = getWaadFacilityId();
  const configuredFacility = await prisma.facility.findUnique({
    where: { id: configuredId },
    select: { id: true },
  });

  if (!configuredFacility) {
    throw new Error("WAAD_FACILITY_ID points to non-existing facility");
  }

  return configuredFacility.id;
}

export type LegacyImportResult = {
  totalRows: number;
  importedRows: number;
  existingRows: number;
  warnings: string[];
  balanceUpdatedBeneficiaries: number;
  linkedCancellations: number;
  createdFacilities: number;
  createdBeneficiaries: number;
  recalculatedBeneficiaries: number;
};

type ImportedRow = {
  rowNumber: number;
  txId: string;
  beneficiaryName: string;
  cardNumber: string;
  amount: number;
  remaining: number;
  typeText: string;
  facilityName: string;
  createdAt: Date;
  txType: TransactionType;
};

type BeneficiaryRef = {
  id: string;
  card_number: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return value;
  const s = String(value ?? "").trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function toAsciiDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

function normalizeRawCardCell(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(Math.trunc(value));
  }

  return toAsciiDigits(String(value ?? "").trim());
}

function cardLookupKey(value: string): string | null {
  const cleaned = toAsciiDigits(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-_]/g, "");

  if (!cleaned) return null;

  const wabMatch = cleaned.match(/^WAB2025(\d+)$/);
  if (wabMatch) return `2025:${String(parseInt(wabMatch[1], 10))}`;

  const yMatch = cleaned.match(/^2025(\d+)$/);
  if (yMatch) return `2025:${String(parseInt(yMatch[1], 10))}`;

  if (/^\d+$/.test(cleaned)) return `2025:${String(parseInt(cleaned, 10))}`;

  return null;
}

function buildBeneficiaryCardLookup(items: BeneficiaryRef[]) {
  const lookup = new Map<string, BeneficiaryRef>();
  for (const item of items) {
    const key = cardLookupKey(item.card_number);
    if (key && !lookup.has(key)) {
      lookup.set(key, item);
    }
  }
  return lookup;
}

function canonicalizeCardNumber(
  cardNumber: string,
  exactMap: Map<string, BeneficiaryRef>,
  lookup: Map<string, BeneficiaryRef>,
) {
  const exact = exactMap.get(cardNumber);
  if (exact) return exact.card_number;

  const key = cardLookupKey(cardNumber);
  if (!key) return cardNumber;

  const mapped = lookup.get(key);
  return mapped?.card_number ?? cardNumber;
}

function parseDateTime(dateValue: unknown, timeValue: unknown) {
  const dateStr = String(dateValue ?? "").trim();
  const timeStr = String(timeValue ?? "").trim();

  const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);

  let hour = 0;
  let minute = 0;
  let second = 0;

  if (timeStr) {
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!timeMatch) return null;
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = Number(timeMatch[3] ?? "0");
  }

  return new Date(year, month - 1, day, hour, minute, second);
}

function mapTransactionType(typeText: string, amount: number) {
  const t = normalizeText(typeText);
  if (amount < 0) return TransactionType.CANCELLATION;
  if (t.includes("ادوية")) return TransactionType.MEDICINE;
  return TransactionType.SUPPLIES;
}

function buildBeneficiarySnapshots(rows: ImportedRow[]) {
  const byCard = new Map<string, { name: string; remaining: number; latestCreatedAt: Date }>();

  for (const row of rows) {
    const existing = byCard.get(row.cardNumber);
    if (!existing) {
      byCard.set(row.cardNumber, {
        name: row.beneficiaryName,
        remaining: row.remaining,
        latestCreatedAt: row.createdAt,
      });
      continue;
    }

    if (row.createdAt > existing.latestCreatedAt) {
      existing.name = row.beneficiaryName;
      existing.remaining = row.remaining;
      existing.latestCreatedAt = row.createdAt;
    }
  }

  return byCard;
}

async function readRowsFromWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("Excel workbook has no worksheets");

  const rows: ImportedRow[] = [];
  const warnings: string[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const txId = String(row.getCell(1).value ?? "").trim();
    const beneficiaryName = String(row.getCell(2).value ?? "").trim();
    const cardNumber = normalizeRawCardCell(row.getCell(3).value).toUpperCase();
    const amount = parseNumber(row.getCell(4).value);
    const remaining = parseNumber(row.getCell(5).value);
    const typeText = String(row.getCell(6).value ?? "").trim();
    const dateValue = row.getCell(7).value;
    const timeValue = row.getCell(8).value;
    const facilityName = String(row.getCell(9).value ?? "").trim();

    if (!txId || !txId.startsWith("c")) return;
    if (!cardNumber || !beneficiaryName) {
      warnings.push(`row ${rowNumber}: missing card/name`);
      return;
    }
    if (!Number.isFinite(amount) || !Number.isFinite(remaining)) {
      warnings.push(`row ${rowNumber}: invalid amount/remaining`);
      return;
    }

    if (amount === 0) {
      warnings.push(`row ${rowNumber}: amount is zero`);
      return;
    }

    const createdAt = parseDateTime(dateValue, timeValue);
    if (!createdAt) {
      warnings.push(`row ${rowNumber}: invalid date/time ${String(dateValue)} ${String(timeValue)}`);
      return;
    }

    rows.push({
      rowNumber,
      txId,
      beneficiaryName,
      cardNumber,
      amount,
      remaining,
      typeText,
      facilityName: facilityName || "System Admin",
      createdAt,
      txType: mapTransactionType(typeText, amount),
    });
  });

  return { rows, warnings };
}

async function recalculateBalancesForBeneficiaries(beneficiaryIds: string[]) {
  if (beneficiaryIds.length === 0) return 0;

  const beneficiaries = await prisma.beneficiary.findMany({
    where: { id: { in: beneficiaryIds } },
    select: {
      id: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      completed_via: true,
    },
  });

  const transactions = await prisma.transaction.findMany({
    where: {
      beneficiary_id: { in: beneficiaryIds },
      is_cancelled: false,
      type: { not: TransactionType.CANCELLATION },
    },
    select: {
      beneficiary_id: true,
      amount: true,
    },
  });

  const spentByBeneficiary = new Map<string, number>();
  for (const tx of transactions) {
    const current = spentByBeneficiary.get(tx.beneficiary_id) || 0;
    spentByBeneficiary.set(tx.beneficiary_id, current + Number(tx.amount));
  }

  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const ben of beneficiaries) {
      const totalBalance = Number(ben.total_balance);
      const totalSpent = spentByBeneficiary.get(ben.id) || 0;
      const correctRemaining = Math.max(0, totalBalance - totalSpent);

      let correctStatus: "ACTIVE" | "FINISHED" | "SUSPENDED";
      if (ben.status === "SUSPENDED") {
        correctStatus = "SUSPENDED";
      } else if (correctRemaining <= 0) {
        correctStatus = "FINISHED";
      } else {
        correctStatus = "ACTIVE";
      }

      const currentRemaining = Number(ben.remaining_balance);
      const balanceChanged = Math.abs(currentRemaining - correctRemaining) > 0.001;
      const statusChanged = ben.status !== correctStatus;
      const completedVia = correctStatus === "FINISHED" ? ben.completed_via ?? "IMPORT" : null;

      if (!balanceChanged && !statusChanged && ben.completed_via === completedVia) continue;

      await tx.beneficiary.update({
        where: { id: ben.id },
        data: {
          remaining_balance: correctRemaining,
          status: correctStatus,
          completed_via: completedVia,
        },
      });
      updated++;
    }
  });

  return updated;
}

export async function processLegacyTransactionsImport(
  fileBuffer: Buffer,
  username: string,
): Promise<{ result?: LegacyImportResult; error?: string }> {
  try {
    const initialBalance = await getCurrentInitialBalance();
    const { rows, warnings } = await readRowsFromWorkbook(fileBuffer);
    if (rows.length === 0) {
      return { error: "الملف لا يحتوي على حركات صالحة." };
    }
    if (rows.length > 10_000) {
      return { error: `عدد الصفوف (${rows.length}) يتجاوز الحد الأقصى المسموح به (10,000). يرجى تقسيم الملف.` };
    }

    const importFacilityId = await resolveImportFacilityId(username);
    const initialSnapshots = buildBeneficiarySnapshots(rows);
    const initialCardNumbers = [...initialSnapshots.keys()];
    const txIds = rows.map((r) => r.txId);
    const facilityNames = [...new Set(rows.map((r) => r.facilityName))];

    const [existingFacilities, existingBeneficiaries, existingTransactions, allBeneficiaries] = await Promise.all([
      prisma.facility.findMany({ where: { name: { in: facilityNames } }, select: { id: true, name: true } }),
      prisma.beneficiary.findMany({ where: { card_number: { in: initialCardNumbers }, deleted_at: null }, select: { id: true, card_number: true } }),
      prisma.transaction.findMany({ where: { id: { in: txIds } }, select: { id: true } }),
      prisma.beneficiary.findMany({
        where: { card_number: { startsWith: "WAB2025" }, deleted_at: null },
        select: { id: true, card_number: true },
      }),
    ]);

    const facilityByName = new Map(existingFacilities.map((f) => [f.name, f]));
    const beneficiaryByCard = new Map(existingBeneficiaries.map((b) => [b.card_number, b]));
    const existingTxIds = new Set(existingTransactions.map((t) => t.id));
    const exactBeneficiaryMap = new Map(allBeneficiaries.map((b) => [b.card_number, b]));
    const beneficiaryLookup = buildBeneficiaryCardLookup(allBeneficiaries);

    const normalizedRows = rows.map((row) => ({
      ...row,
      cardNumber: canonicalizeCardNumber(row.cardNumber, exactBeneficiaryMap, beneficiaryLookup),
    }));

    const snapshots = buildBeneficiarySnapshots(normalizedRows);
    const cardNumbers = [...snapshots.keys()];

    const missingFacilityNames = facilityNames.filter((name) => !facilityByName.has(name));
    const missingBeneficiaries = cardNumbers.filter((card) => !beneficiaryByCard.has(card));
    const insertableRows = normalizedRows.filter((row) => !existingTxIds.has(row.txId));

    let createdFacilities = 0;
    let createdBeneficiaries = 0;

    await prisma.$transaction(async (tx) => {
      for (const name of missingFacilityNames) {
        const created = await tx.facility.create({
          data: {
            name,
            username: `import_${Date.now()}_${createdFacilities + 1}`,
            password_hash: "IMPORT_ONLY",
            is_admin: false,
            is_manager: false,
            must_change_password: true,
          },
          select: { id: true, name: true },
        });
        facilityByName.set(name, created);
        createdFacilities++;
      }

      for (const card of missingBeneficiaries) {
        const snapshot = snapshots.get(card);
        if (!snapshot) continue;

        const remaining = Number(snapshot.remaining);
        // حساب total_balance الفعلي: مجموع الحركات غير الملغاة + الرصيد المتبقي
        const txsForCard = normalizedRows.filter((r) => r.cardNumber === card && r.txType !== TransactionType.CANCELLATION);
        const totalSpent = txsForCard.reduce((sum, r) => sum + Math.abs(r.amount), 0);
        const computedTotal = Math.max(initialBalance, totalSpent + remaining);

        const created = await tx.beneficiary.create({
          data: {
            card_number: card,
            name: snapshot.name,
            total_balance: computedTotal,
            remaining_balance: remaining,
            status: remaining <= 0 ? "FINISHED" : "ACTIVE",
            ...(remaining <= 0 ? { completed_via: "IMPORT" } : {}),
          },
          select: { id: true, card_number: true },
        });
        beneficiaryByCard.set(card, created);
        createdBeneficiaries++;
      }

      for (const row of insertableRows) {
        const beneficiary = beneficiaryByCard.get(row.cardNumber);
        const facility = facilityByName.get(row.facilityName);
        if (!beneficiary || !facility) {
          throw new Error(`Missing beneficiary/facility mapping for tx ${row.txId}`);
        }

        await tx.transaction.create({
          data: {
            id: row.txId,
            beneficiary_id: beneficiary.id,
            facility_id: facility.id,
            amount: row.amount,
            type: row.txType,
            is_cancelled: false,
            created_at: row.createdAt,
          },
        });
      }
    });

    const affectedBeneficiaryIds = [...new Set(insertableRows
      .map((row) => beneficiaryByCard.get(row.cardNumber)?.id)
      .filter((value): value is string => Boolean(value)))];

    const linkedCandidates = await prisma.transaction.findMany({
      where: { beneficiary_id: { in: affectedBeneficiaryIds } },
      select: {
        id: true,
        beneficiary_id: true,
        amount: true,
        type: true,
        created_at: true,
        is_cancelled: true,
      },
      orderBy: [{ beneficiary_id: "asc" }, { created_at: "asc" }],
    });

    let linkedCancellations = 0;
    for (const cancelTx of linkedCandidates) {
      if (cancelTx.type !== TransactionType.CANCELLATION) continue;

      const targetAmount = Math.abs(Number(cancelTx.amount));
      if (targetAmount <= 0) continue;

      const original = [...linkedCandidates]
        .reverse()
        .find((item) =>
          item.beneficiary_id === cancelTx.beneficiary_id &&
          item.type !== TransactionType.CANCELLATION &&
          !item.is_cancelled &&
          item.created_at <= cancelTx.created_at &&
          Math.abs(Number(item.amount) - targetAmount) < 0.0001,
        );

      if (!original) {
        warnings.push(`حركة إلغاء يتيمة (${cancelTx.id}) بمبلغ ${targetAmount} — لم يُعثر على الحركة الأصلية`);
        continue;
      }

      await prisma.$transaction([
        prisma.transaction.update({ where: { id: original.id }, data: { is_cancelled: true } }),
        prisma.transaction.update({ where: { id: cancelTx.id }, data: { original_transaction_id: original.id } }),
      ]);
      linkedCancellations++;
    }

    const recalculatedBeneficiaries = await recalculateBalancesForBeneficiaries(affectedBeneficiaryIds);

    await prisma.auditLog.create({
      data: {
        facility_id: importFacilityId,
        user: username,
        action: "IMPORT_TRANSACTIONS_REPORT_WITH_RECALC",
        metadata: {
          total_rows: rows.length,
          imported_rows: insertableRows.length,
          existing_rows: rows.length - insertableRows.length,
          created_facilities: createdFacilities,
          created_beneficiaries: createdBeneficiaries,
          linked_cancellations: linkedCancellations,
          recalculated_beneficiaries: recalculatedBeneficiaries,
          warnings_count: warnings.length,
        },
      },
    });

    return {
      result: {
        totalRows: rows.length,
        importedRows: insertableRows.length,
        existingRows: rows.length - insertableRows.length,
        warnings,
        balanceUpdatedBeneficiaries: affectedBeneficiaryIds.length,
        linkedCancellations,
        createdFacilities,
        createdBeneficiaries,
        recalculatedBeneficiaries,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "حدث خطأ غير متوقع أثناء استيراد الحركات القديمة." };
  }
}
