"use server";

import { Prisma, TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";

/** Waad admin facility ID */
const WAAD_FACILITY_ID = "cmmqyphii0000u9x0knelmjp9";

// ─── Types ───────────────────────────────────────────────────────

export type TransactionImportResult = {
  totalRows: number;
  importedFamilies: number;
  importedTransactions: number;
  suspendedFamilies: number;
  skippedAlreadySuspended: number;
  skippedNotFound: number;
  skippedAlreadyImported: number;
  notFoundRows: NotFoundRow[];
};

export type NotFoundRow = {
  rowNumber: number;
  cardNumber: string;
  name: string;
  familyCount: number;
  totalBalance: number;
  usedBalance: number;
};

type ParsedRow = {
  rowNumber: number;
  cardNumber: string;
  name: string;
  familyCount: number;
  totalBalance: number;
  usedBalance: number;
};

// ─── Card Number Lookup ──────────────────────────────────────────

/**
 * Build a map: rawNumber (no leading zeros) → full card number from DB.
 * Only base cards (WAB2025 + digits, no suffix) are indexed.
 */
async function buildCardLookup(): Promise<Map<string, string>> {
  const allBeneficiaries = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: { card_number: true },
  });

  const lookup = new Map<string, string>();
  for (const b of allBeneficiaries) {
    if (/^WAB2025\d+$/.test(b.card_number)) {
      const rawNum = String(parseInt(b.card_number.slice(7), 10));
      lookup.set(rawNum, b.card_number);
    }
  }
  return lookup;
}

/**
 * Resolve the raw card number from Excel to a full WAB2025 base card.
 */
function resolveCardNumber(rawCard: string, lookup: Map<string, string>): string | null {
  const cleaned = rawCard.trim();
  if (!cleaned) return null;

  // Already a full card?
  if (cleaned.startsWith("WAB2025")) {
    const numPart = cleaned.slice(7);
    if (/^\d+$/.test(numPart)) {
      const rawNum = String(parseInt(numPart, 10));
      return lookup.get(rawNum) ?? null;
    }
    return null;
  }

  // Raw number
  const rawNum = String(parseInt(cleaned, 10));
  if (isNaN(parseInt(cleaned, 10))) return null;
  return lookup.get(rawNum) ?? null;
}

// ─── Parse Excel ─────────────────────────────────────────────────

function parseExcelRows(workbook: ExcelJS.Workbook): ParsedRow[] {
  const ws = workbook.worksheets[0];
  if (!ws) return [];

  const rows: ParsedRow[] = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    // row.values is 1-based sparse array — cast to allow numeric indexing
    const vals = row.values as unknown[];
    const cardNumber = String(vals[1] ?? "").trim();
    const name = String(vals[2] ?? "").trim();
    const familyCount = Number(vals[3]) || 0;
    const totalBalance = Number(vals[4]) || 0;
    const usedBalance = Number(vals[5]) || 0;

    if (cardNumber) {
      rows.push({ rowNumber: rowNum, cardNumber, name, familyCount, totalBalance, usedBalance });
    }
  });

  return rows;
}

// ─── Main Import Logic ───────────────────────────────────────────

export async function processTransactionImport(
  fileBuffer: Buffer,
  username: string,
): Promise<{ result?: TransactionImportResult; error?: string }> {
  // 1. Parse file
  const workbook = new ExcelJS.Workbook();
  const fileArrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(fileArrayBuffer);
  const rows = parseExcelRows(workbook);

  if (rows.length === 0) {
    return { error: "الملف لا يحتوي على بيانات." };
  }

  // 2. Build lookup
  const lookup = await buildCardLookup();

  // 3. Categorize rows
  const notFoundRows: NotFoundRow[] = [];
  const toImport: Array<{ row: ParsedRow; baseCard: string }> = [];
  const toSuspend: Array<{ row: ParsedRow; baseCard: string }> = [];

  for (const row of rows) {
    // رصيد كلي = 0 أو رصيد مستخدم = 0 → تصفير الأسرة وإنهاء رصيدها
    if (row.totalBalance === 0 || row.usedBalance <= 0) {
      const baseCard = resolveCardNumber(row.cardNumber, lookup);
      if (!baseCard) {
        notFoundRows.push({
          rowNumber: row.rowNumber,
          cardNumber: row.cardNumber,
          name: row.name,
          familyCount: row.familyCount,
          totalBalance: row.totalBalance,
          usedBalance: row.usedBalance,
        });
      } else {
        toSuspend.push({ row, baseCard });
      }
      continue;
    }

    const baseCard = resolveCardNumber(row.cardNumber, lookup);
    if (!baseCard) {
      notFoundRows.push({
        rowNumber: row.rowNumber,
        cardNumber: row.cardNumber,
        name: row.name,
        familyCount: row.familyCount,
        totalBalance: row.totalBalance,
        usedBalance: row.usedBalance,
      });
      continue;
    }

    toImport.push({ row, baseCard });
  }

  // 4a. Suspend families with totalBalance = 0
  let suspendedFamilies = 0;
  let skippedAlreadySuspended = 0;

  for (const { baseCard } of toSuspend) {
    const suspendResult = await suspendFamily(baseCard);
    if (suspendResult === "already_suspended") {
      skippedAlreadySuspended++;
    } else {
      suspendedFamilies++;
    }
  }

  // 4b. Process imports
  let importedFamilies = 0;
  let importedTransactions = 0;
  let skippedAlreadyImported = 0;

  for (const { row, baseCard } of toImport) {
    const familyResult = await importFamilyTransactions(baseCard, row.usedBalance);

    if (familyResult === "already_imported") {
      skippedAlreadyImported++;
    } else {
      importedFamilies++;
      importedTransactions += familyResult.count;
    }
  }

  // 5. Audit log
  const facility = await prisma.facility.findUnique({
    where: { username },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: facility?.id ?? WAAD_FACILITY_ID,
      user: username,
      action: "IMPORT_TRANSACTIONS",
      metadata: {
        totalRows: rows.length,
        importedFamilies,
        importedTransactions,
        suspendedFamilies,
        skippedAlreadySuspended,
        skippedNotFound: notFoundRows.length,
        skippedAlreadyImported,
      },
    },
  });

  return {
    result: {
      totalRows: rows.length,
      importedFamilies,
      importedTransactions,
      suspendedFamilies,
      skippedAlreadySuspended,
      skippedNotFound: notFoundRows.length,
      skippedAlreadyImported,
      notFoundRows,
    },
  };
}

// ─── Family Import ───────────────────────────────────────────────

async function importFamilyTransactions(
  baseCard: string,
  totalUsedAmount: number,
): Promise<"already_imported" | { count: number }> {
  // Find ALL family members (base card + suffixes like W1, S1, D1, etc.)
  const familyMembers = await prisma.beneficiary.findMany({
    where: {
      card_number: { startsWith: baseCard },
      deleted_at: null,
    },
    select: { id: true, card_number: true, remaining_balance: true, total_balance: true, status: true },
    orderBy: { card_number: "asc" },
  });

  if (familyMembers.length === 0) {
    return "already_imported"; // shouldn't happen since we checked lookup
  }

  // Check if any IMPORT transaction already exists for the base member
  const existingImport = await prisma.transaction.findFirst({
    where: {
      beneficiary_id: familyMembers[0].id,
      type: TransactionType.IMPORT,
      facility_id: WAAD_FACILITY_ID,
    },
  });

  if (existingImport) {
    return "already_imported";
  }

  // Distribute amount equally among family members
  const perMember = Math.round((totalUsedAmount / familyMembers.length) * 100) / 100;
  let transactionCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const member of familyMembers) {
      const currentBalance = Number(member.remaining_balance);
      const deductAmount = Math.min(perMember, currentBalance);

      if (deductAmount <= 0) continue;

      const newBalance = currentBalance - deductAmount;
      const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

      // Update balance
      await tx.beneficiary.update({
        where: { id: member.id },
        data: {
          remaining_balance: newBalance,
          status: newStatus as "ACTIVE" | "FINISHED",
        },
      });

      // Create transaction
      await tx.transaction.create({
        data: {
          beneficiary_id: member.id,
          facility_id: WAAD_FACILITY_ID,
          amount: deductAmount,
          type: TransactionType.IMPORT,
        },
      });

      transactionCount++;
    }
  });

  return { count: transactionCount };
}

// ─── Suspend Family ──────────────────────────────────────────────

/**
 * Zero out total_balance and remaining_balance for all family members
 * and set their status to SUSPENDED.
 * Idempotent: skips families that are already fully suspended.
 */
async function suspendFamily(
  baseCard: string,
): Promise<"already_suspended" | { count: number }> {
  const familyMembers = await prisma.beneficiary.findMany({
    where: {
      card_number: { startsWith: baseCard },
      deleted_at: null,
    },
    select: { id: true, status: true, total_balance: true },
    orderBy: { card_number: "asc" },
  });

  if (familyMembers.length === 0) return "already_suspended";

  // If every member already has total_balance=0, skip (already processed)
  const allZeroed = familyMembers.every((m) => Number(m.total_balance) === 0);
  if (allZeroed) return "already_suspended";

  await prisma.$transaction(
    familyMembers.map((member) =>
      prisma.beneficiary.update({
        where: { id: member.id },
        data: {
          total_balance: 0,
          remaining_balance: 0,
          status: "FINISHED",
        },
      }),
    ),
  );

  return { count: familyMembers.length };
}

// ─── Generate Not-Found Report ───────────────────────────────────

export async function generateNotFoundWorkbook(notFoundRows: NotFoundRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("غير موجودين");

  ws.addRow(["رقم البطاقة", "الاسم", "عدد الأفراد", "الرصيد الكلي", "الرصيد المستخدم", "رقم الصف في الملف"]);

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center" };

  for (const row of notFoundRows) {
    ws.addRow([row.cardNumber, row.name, row.familyCount, row.totalBalance, row.usedBalance, row.rowNumber]);
  }

  ws.columns.forEach((col) => {
    col.width = 25;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
