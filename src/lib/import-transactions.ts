"use server";

import { TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";
import { roundCurrency } from "@/lib/money";

/** Waad company facility ID (optional fallback) */
function getWaadFacilityId(): string | undefined {
  const id = process.env.WAAD_FACILITY_ID?.trim();
  return id || undefined;
}

async function resolveImportFacilityId(username: string, selectedFacilityId?: string): Promise<string> {
  if (selectedFacilityId) {
    const selectedFacility = await prisma.facility.findFirst({
      where: { id: selectedFacilityId, deleted_at: null },
      select: { id: true },
    });
    if (!selectedFacility) {
      throw new Error("Selected facility does not exist");
    }
    return selectedFacility.id;
  }

  const configuredId = getWaadFacilityId();
  if (configuredId) {
    const configuredFacility = await prisma.facility.findFirst({
      where: { id: configuredId, deleted_at: null },
      select: { id: true },
    });

    if (configuredFacility?.id) {
      return configuredFacility.id;
    }
  }

  const actorFacility = await prisma.facility.findFirst({
    where: { username, deleted_at: null },
    select: { id: true },
  });

  if (actorFacility?.id) return actorFacility.id;

  throw new Error("WAAD_FACILITY_ID points to non-existing facility");
}

// ─── Types ───────────────────────────────────────────────────────

export type TransactionImportResult = {
  totalRows: number;
  importedFamilies: number;
  importedTransactions: number;
  updatedFamilies: number;
  updatedTransactions: number;
  suspendedFamilies: number;
  skippedAlreadySuspended: number;
  balanceSetFamilies: number;
  skippedAlreadyCorrect: number;
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

type ImportAppliedRow = {
  beneficiaryId: string;
  beneficiaryName: string;
  cardNumber: string;
  familyBaseCard: string;
  familySize: number;
  balanceBefore: number;
  deductedAmount: number;
  familyTotalDeduction: number;
  balanceAfter: number;
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
  selectedFacilityId?: string,
): Promise<{ result?: TransactionImportResult; error?: string }> {
  try {
    // 1. Parse file
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(fileBuffer as any);
    const rows = parseExcelRows(workbook);

    if (rows.length === 0) {
      return { error: "الملف لا يحتوي على بيانات." };
    }

    const importFacilityId = await resolveImportFacilityId(username, selectedFacilityId);

    // 2. Build lookup
    const lookup = await buildCardLookup();

    // 3. Categorize rows
    const notFoundRows: NotFoundRow[] = [];
    const toImport: Array<{ row: ParsedRow; baseCard: string }> = [];
    const toSuspend: Array<{ row: ParsedRow; baseCard: string }> = [];
    const toSetBalance: Array<{ row: ParsedRow; baseCard: string }> = [];

    for (const row of rows) {
      // القاعدة: (الرصيد الكلي = 0 && الرصيد المستخدم = 0) → تصفير الأسرة وإيقافها
      if (row.totalBalance === 0 && row.usedBalance === 0) {
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

      // القاعدة: (الرصيد الكلي > 0 && الرصيد المستخدم <= 0) → توزيع الرصيد الكلي بدون خصم
      if (row.totalBalance > 0 && row.usedBalance <= 0) {
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
          toSetBalance.push({ row, baseCard });
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

    // 4b. Set balance for families with usedBalance = 0 and totalBalance > 0
    let balanceSetFamilies = 0;
    let skippedAlreadyCorrect = 0;

    for (const { row, baseCard } of toSetBalance) {
      const setResult = await setFamilyBalance(baseCard, row.totalBalance, row.familyCount);
      if (setResult === "already_correct") {
        skippedAlreadyCorrect++;
      } else {
        balanceSetFamilies++;
      }
    }

    // 4c. Process imports
    let importedFamilies = 0;
    let importedTransactions = 0;
    const skippedAlreadyImported = 0;
    let updatedFamilies = 0;
    let updatedTransactions = 0;
    const appliedRows: ImportAppliedRow[] = [];

    for (const { row, baseCard } of toImport) {
      // إذا كان هناك رصيد كلي بالملف، يجب ضبط رصيد الأسرة أولاً
      // ثم تطبيق الخصم (usedBalance) حتى لا نعتمد على أرصدة قديمة.
      if (row.totalBalance > 0) {
        const setResult = await setFamilyBalance(baseCard, row.totalBalance, row.familyCount);
        if (setResult === "already_correct") {
          skippedAlreadyCorrect++;
        } else {
          balanceSetFamilies++;
        }
      }

      const familyResult = await importFamilyTransactions(baseCard, row.usedBalance, importFacilityId, row.familyCount);
      appliedRows.push(...familyResult.appliedRows);

      if (familyResult.mode === "updated") {
        updatedFamilies++;
        updatedTransactions += familyResult.count;
      } else {
        importedFamilies++;
        importedTransactions += familyResult.count;
      }
    }

    // 5. Audit log
    await prisma.auditLog.create({
      data: {
        facility_id: importFacilityId,
        user: username,
        action: "IMPORT_TRANSACTIONS",
        metadata: {
          totalRows: rows.length,
          importedFamilies,
          importedTransactions,
          suspendedFamilies,
          skippedAlreadySuspended,
          balanceSetFamilies,
          skippedAlreadyCorrect,
          skippedNotFound: notFoundRows.length,
          skippedAlreadyImported,
          updatedFamilies,
          updatedTransactions,
          appliedRows,
        },
      },
    });

    return {
      result: {
        totalRows: rows.length,
        importedFamilies,
        importedTransactions,
        updatedFamilies,
        updatedTransactions,
        suspendedFamilies,
        skippedAlreadySuspended,
        balanceSetFamilies,
        skippedAlreadyCorrect,
        skippedNotFound: notFoundRows.length,
        skippedAlreadyImported,
        notFoundRows,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "حدث خطأ غير متوقع أثناء معالجة الملف." };
  }
}

// ─── Family Import ───────────────────────────────────────────────

async function importFamilyTransactions(
  baseCard: string,
  totalUsedAmount: number,
  facilityId: string,
  expectedFamilyCount?: number,
): Promise<{ count: number; mode: "created" | "updated"; appliedRows: ImportAppliedRow[] }> {
  let transactionCount = 0;
  const appliedRows: ImportAppliedRow[] = [];
  let hasExistingImport = false;

  await prisma.$transaction(async (tx) => {
    // 1. قفل صفوف أعضاء العائلة لمنع race condition مع خصم يدوي متزامن
    const familyMembers = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; total_balance: number; status: string }>>`
      SELECT id, name, card_number, remaining_balance, total_balance, status
      FROM "Beneficiary"
      WHERE card_number LIKE ${baseCard + '%'}
        AND "deleted_at" IS NULL
      ORDER BY card_number ASC
      FOR UPDATE
    `;

    if (familyMembers.length === 0) {
      return;
    }

    const memberIds = familyMembers.map((m) => m.id);

    const existingImports = await tx.transaction.findMany({
      where: {
        beneficiary_id: { in: memberIds },
        type: TransactionType.IMPORT,
        facility_id: facilityId,
        is_cancelled: false,
      },
      select: { id: true, beneficiary_id: true, amount: true },
      orderBy: { created_at: "asc" },
    });
    hasExistingImport = existingImports.length > 0;

    // Distribute amount by family size from file when available.
    // This prevents over-deducting when DB has fewer members than the file family size.
    const divisor = Math.max(1, Number(expectedFamilyCount) || familyMembers.length);
    const perMemberAmount = roundCurrency(totalUsedAmount / divisor);

    const importsByMember = new Map<string, Array<{ id: string; amount: number }>>();
    for (const imp of existingImports) {
      const arr = importsByMember.get(imp.beneficiary_id) ?? [];
      arr.push({ id: imp.id, amount: Number(imp.amount) });
      importsByMember.set(imp.beneficiary_id, arr);
    }

    // --- مرحلة 1: حساب الخصم لكل فرد بالتقسيم على عدد أفراد الأسرة ---
    type MemberCalc = {
      member: typeof familyMembers[0];
      existingForMember: Array<{ id: string; amount: number }>;
      balanceBeforeImport: number;
      deductAmount: number;
      newBalance: number;
    };
    const calcs: MemberCalc[] = [];

    for (let i = 0; i < familyMembers.length; i++) {
      const member = familyMembers[i];
      const currentBalance = Number(member.remaining_balance);
      const existingForMember = importsByMember.get(member.id) ?? [];
      const previousImported = existingForMember.reduce((sum, item) => sum + Number(item.amount), 0);
      const balanceBeforeImport = roundCurrency(currentBalance + previousImported);
      const deductAmount = roundCurrency(perMemberAmount);
      const newBalance = roundCurrency(Math.max(0, balanceBeforeImport - deductAmount));

      calcs.push({ member, existingForMember, balanceBeforeImport, deductAmount, newBalance });
    }

    // --- مرحلة 2: تطبيق التغييرات ---
    for (const c of calcs) {
      const { member, existingForMember, balanceBeforeImport, deductAmount, newBalance } = c;
      const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

      appliedRows.push({
        beneficiaryId: member.id,
        beneficiaryName: member.name,
        cardNumber: member.card_number,
        familyBaseCard: baseCard,
        familySize: familyMembers.length,
        balanceBefore: balanceBeforeImport,
        deductedAmount: deductAmount,
        familyTotalDeduction: totalUsedAmount,
        balanceAfter: newBalance,
      });

      // Update balance
      await tx.beneficiary.update({
        where: { id: member.id },
        data: {
          remaining_balance: newBalance,
          status: newStatus as "ACTIVE" | "FINISHED",
          completed_via: newStatus === "FINISHED" ? "IMPORT" : undefined,
        },
      });

      if (deductAmount <= 0) {
        if (existingForMember.length > 0) {
          await tx.transaction.deleteMany({
            where: { id: { in: existingForMember.map((item) => item.id) } },
          });
        }
        continue;
      }

      if (existingForMember.length === 0) {
        await tx.transaction.create({
          data: {
            beneficiary_id: member.id,
            facility_id: facilityId,
            amount: deductAmount,
            type: TransactionType.IMPORT,
          },
        });
      } else {
        await tx.transaction.update({
          where: { id: existingForMember[0].id },
          data: { amount: deductAmount },
        });

        if (existingForMember.length > 1) {
          await tx.transaction.deleteMany({
            where: { id: { in: existingForMember.slice(1).map((item) => item.id) } },
          });
        }
      }

      transactionCount++;
    }
  });

  return { count: transactionCount, mode: hasExistingImport ? "updated" : "created", appliedRows };
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
          // FIX: SUSPENDED وليس FINISHED — الإيقاف قرار خارجي وليس استنفاداً للرصيد
          status: "SUSPENDED" as const,
          completed_via: null,
        },
      }),
    ),
  );

  return { count: familyMembers.length };
}

// ─── Set Family Balance (usedBalance=0, totalBalance>0) ─────────

/**
 * Distribute totalBalance equally among family members, setting both
 * total_balance and remaining_balance. Reactivates SUSPENDED members.
 * Removes any existing IMPORT transactions (cleanup from wrong previous runs).
 * Idempotent: skips if all members already have the correct balance and are ACTIVE.
 */
async function setFamilyBalance(
  baseCard: string,
  totalBalance: number,
  expectedFamilyCount?: number,
): Promise<"already_correct" | { count: number }> {
  const familyMembers = await prisma.beneficiary.findMany({
    where: {
      card_number: { startsWith: baseCard },
      deleted_at: null,
    },
    select: { id: true, status: true, total_balance: true, remaining_balance: true },
    orderBy: { card_number: "asc" },
  });

  if (familyMembers.length === 0) return "already_correct";

  const divisor = Math.max(1, Number(expectedFamilyCount) || familyMembers.length);
  const perMember = roundCurrency(totalBalance / divisor);
  const memberIds = familyMembers.map((m) => m.id);

  // تنظيف حركات IMPORT القديمة دائماً لمنع أي أثر قديم على الرصيد الدفتري.
  await prisma.transaction.deleteMany({
    where: {
      beneficiary_id: { in: memberIds },
      type: "IMPORT",
      is_cancelled: false,
    },
  });

  // Check if already correct
  const alreadyCorrect = familyMembers.every((m, i) => {
    const expected = perMember;
    return (
      m.status === "ACTIVE" &&
      Number(m.total_balance) === expected &&
      Number(m.remaining_balance) === expected
    );
  });
  if (alreadyCorrect) return "already_correct";

  await prisma.$transaction(async (tx) => {
    // توزيع الرصيد وإعادة التفعيل
    for (let i = 0; i < familyMembers.length; i++) {
      const member = familyMembers[i];
      const balance = perMember;
      await tx.beneficiary.update({
        where: { id: member.id },
        data: {
          total_balance: balance,
          remaining_balance: balance,
          status: "ACTIVE",
          completed_via: null,
        },
      });
    }
  });

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
