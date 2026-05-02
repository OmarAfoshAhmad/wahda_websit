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
  // نثبت الاستيراد باسم/معرف المستخدم الحالي فقط (المسجل دخول)
  // حتى لا يتم نسب الحركات إلى مرفق آخر عبر اختيار يدوي من الواجهة.
  void selectedFacilityId;

  const actorFacility = await prisma.facility.findFirst({
    where: { username, deleted_at: null },
    select: { id: true },
  });

  if (actorFacility?.id) return actorFacility.id;

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

  throw new Error("WAAD_FACILITY_ID points to non-existing facility");
}

// ─── Types ───────────────────────────────────────────────────────

export type TransactionImportResult = {
  auditLogId: string;
  importMode: "replace_old_imports" | "incremental_update";
  purgeMissingFamiliesEnabled: boolean;
  cleanupOldSettlementsEnabled: boolean;
  cleanupPurgedMissingFamilies: number;
  cleanupDeletedMissingFamilyArchiveRows: number;
  cleanupDeletedImportTransactions: number;
  cleanupDeletedSettlementTransactions: number;
  cleanupCancelledImportTransactions: number;
  cleanupDeletedCancelledSettlementTransactions: number;
  cleanupTouchedBeneficiaries: number;
  totalRows: number;
  duplicateCardCount: number;
  importedFamilies: number;
  importedTransactions: number;
  updatedFamilies: number;
  updatedTransactions: number;
  suspendedFamilies: number;
  skippedAlreadySuspended: number;
  balanceSetFamilies: number;
  skippedAlreadyCorrect: number;
  preImportBalanceAdjustedFamilies: number;
  preImportBalanceAlreadyCorrect: number;
  skippedNotFound: number;
  skippedAlreadyImported: number;
  autoDebtAffectedDebtors: number;
  autoDebtSettledDebtors: number;
  autoDebtUnresolvedDebtors: number;
  notFoundRows: NotFoundRow[];
  detailedReport: ImportDetailedReport;
};

type BeneficiaryBalanceSnapshot = {
  beneficiaryId: string;
  beneficiaryName: string;
  cardNumber: string;
  totalBalance: number;
  remainingBalance: number;
  status: "ACTIVE" | "FINISHED" | "SUSPENDED";
  completedVia: string | null;
};

type DeletedImportTransactionSnapshot = {
  id: string;
  beneficiaryId: string;
  facilityId: string;
  amount: number;
  type: "IMPORT";
  isCancelled: boolean;
  createdAt: string;
  originalTransactionId: string | null;
  idempotencyKey: string | null;
};

type FamilyImportArchiveSnapshot = {
  familyBaseCard: string;
  familyCountFromFile: number;
  totalBalanceFromFile: number;
  usedBalanceFromFile: number;
  sourceRowNumber: number | null;
  importedBy: string | null;
  lastImportedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ImportDetailedReport = {
  snapshotBefore: {
    affectedFamilies: string[];
    affectedMembersCount: number;
    members: BeneficiaryBalanceSnapshot[];
    familyArchiveBefore: FamilyImportArchiveSnapshot[];
  };
  cleanup: {
    mode: "hard_delete";
    deletedImportTransactionsCount: number;
    deletedImportTransactions: DeletedImportTransactionSnapshot[];
    touchedBeneficiaries: number;
  };
  execution: {
    appliedRows: ImportAppliedRow[];
  };
  snapshotAfter: {
    members: BeneficiaryBalanceSnapshot[];
    familyArchiveAfter: FamilyImportArchiveSnapshot[];
  };
  rollbackSnapshot: {
    affectedFamilies: string[];
    affectedMemberIds: string[];
    membersBefore: BeneficiaryBalanceSnapshot[];
    deletedOldImportTransactions: DeletedImportTransactionSnapshot[];
    familyArchiveBefore: FamilyImportArchiveSnapshot[];
  };
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

type ImportTxRow = {
  id: string;
  beneficiary_id: string;
  facility_id: string;
  amount: number;
  type: string;
  is_cancelled: boolean;
  created_at: Date;
  original_transaction_id: string | null;
  idempotency_key: string | null;
};

type ParsedRow = {
  rowNumber: number;
  cardNumber: string;
  name: string;
  familyCount: number;
  totalBalance: number;
  usedBalance: number;
};

const INTERACTIVE_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;

export type TransactionImportPurgePreview = {
  replaceOldImports: boolean;
  purgeMissingFamilies: boolean;
  targetFamiliesInFile: number;
  missingFamiliesToPurge: number;
  sampleMissingFamilies: string[];
};

export type TransactionImportProgress = {
  phase: "parsing" | "categorizing" | "cleanup" | "suspend" | "balance" | "import" | "audit" | "done";
  totalRows: number;
  processedRows: number;
  progressPercent: number;
  message: string;
};

function familySuffixRegex(baseCard: string): string {
  // Match family-member suffixes with or without numeric index (M/F/H or M1/F1/H2...).
  return `^${baseCard}[WSDMFHV][0-9]*$`;
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFamilyBaseRegex(baseCards: string[]): string {
  const parts = baseCards.map((card) => escapeRegexLiteral(String(card ?? "").trim())).filter(Boolean);
  if (parts.length === 0) return "^$";
  return `^(${parts.join("|")})([WSDMFHV][0-9]*)?$`;
}

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

function normalizeUsedBalanceForImport(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  // Business rule: grouped import used balance must be integer-only.
  // Math.round بدل Math.trunc لمنع خسارة الكسور الصامتة (0.75 → 1 بدل 0)
  return Math.round(numeric);
}

// ─── Parse Excel ─────────────────────────────────────────────────

function parseExcelRows(workbook: ExcelJS.Workbook): ParsedRow[] {
  const ws = workbook.worksheets[0];
  if (!ws) return [];

  // ── التحقق من هيكل ملف Excel (عدد الأعمدة) ──
  const headerRow = ws.getRow(1);
  if (headerRow) {
    const headerVals = headerRow.values as unknown[];
    const nonEmptyCols = (headerVals || []).filter((v, i) => i > 0 && v != null && String(v).trim() !== "");
    if (nonEmptyCols.length < 5) {
      throw new Error(
        "هيكل الملف غير صحيح: يجب أن يحتوي على 5 أعمدة على الأقل (رقم البطاقة، الاسم، عدد الأفراد، الرصيد الكلي، الرصيد المستخدم)",
      );
    }
  }

  const rows: ParsedRow[] = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    // row.values is 1-based sparse array — cast to allow numeric indexing
    const vals = row.values as unknown[];
    const cardNumber = String(vals[1] ?? "").trim();
    const name = String(vals[2] ?? "").trim();
    const familyCount = Number(vals[3]) || 0;
    const totalBalance = Number(vals[4]) || 0;
    const usedBalance = normalizeUsedBalanceForImport(vals[5]);

    if (cardNumber) {
      rows.push({ rowNumber: rowNum, cardNumber, name, familyCount, totalBalance, usedBalance });
    }
  });

  return rows;
}

export async function estimateTransactionImportPurgePreview(
  fileBuffer: Buffer,
  username: string,
  selectedFacilityId?: string,
  options?: {
    replaceOldImports?: boolean;
    purgeMissingFamilies?: boolean;
  },
): Promise<TransactionImportPurgePreview> {
  const replaceOldImports = options?.replaceOldImports !== false;
  const purgeMissingFamilies = replaceOldImports && options?.purgeMissingFamilies === true;

  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(fileBuffer as any);
  const rows = parseExcelRows(workbook);

  const cardRowMap = new Map<string, ParsedRow>();
  for (const row of rows) {
    const key = row.cardNumber.trim();
    if (!key) continue;
    cardRowMap.set(key, row);
  }
  const deduplicatedRows = Array.from(cardRowMap.values());

  const lookup = await buildCardLookup();
  const targetBaseCardsSet = new Set<string>();

  for (const row of deduplicatedRows) {
    const baseCard = resolveCardNumber(row.cardNumber, lookup);
    if (!baseCard) continue;
    targetBaseCardsSet.add(baseCard);
  }

  const targetBaseCards = Array.from(targetBaseCardsSet);
  if (!purgeMissingFamilies) {
    return {
      replaceOldImports,
      purgeMissingFamilies,
      targetFamiliesInFile: targetBaseCards.length,
      missingFamiliesToPurge: 0,
      sampleMissingFamilies: [],
    };
  }

  const importFacilityId = await resolveImportFacilityId(username, selectedFacilityId);
  const missingBaseCards = await findImportBaseCardsMissingFromFile(importFacilityId, targetBaseCards);

  return {
    replaceOldImports,
    purgeMissingFamilies,
    targetFamiliesInFile: targetBaseCards.length,
    missingFamiliesToPurge: missingBaseCards.length,
    sampleMissingFamilies: missingBaseCards.slice(0, 20),
  };
}

// ─── Main Import Logic ───────────────────────────────────────────

export async function processTransactionImport(
  fileBuffer: Buffer,
  username: string,
  selectedFacilityId?: string,
  options?: {
    // سيتم تجاهل هذا الخيار ويكون دائمًا true
    replaceOldImports?: boolean;
    purgeMissingFamilies?: boolean;
    cleanupOldSettlements?: boolean;
    onProgress?: (progress: TransactionImportProgress) => void | Promise<void>;
  },
): Promise<{ result?: TransactionImportResult; error?: string }> {
  try {
    const reportProgress = async (
      phase: TransactionImportProgress["phase"],
      totalRows: number,
      processedRows: number,
      message: string,
    ) => {
      if (!options?.onProgress) return;
      const safeTotal = Math.max(1, totalRows);
      const safeProcessed = Math.max(0, Math.min(processedRows, safeTotal));
      await options.onProgress({
        phase,
        totalRows,
        processedRows: safeProcessed,
        progressPercent: Math.max(0, Math.min(100, Math.round((safeProcessed / safeTotal) * 100))),
        message,
      });
    };

    await ensureFamilyImportArchiveTable();

    // 1. Parse file
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(fileBuffer as any);
    const rows = parseExcelRows(workbook);
    await reportProgress("parsing", Math.max(1, rows.length), 1, "تم تحليل ملف Excel");

    if (rows.length === 0) {
      return { error: "الملف لا يحتوي على بيانات." };
    }

    // كشف البطاقات المكررة وتجميعها (الصف الأخير يُعتمد) مع تسجيل التفاصيل
    const cardRowMap = new Map<string, ParsedRow>();
    let duplicateCardCount = 0;
    const duplicateDetails: Array<{ card: string; replacedRow: number; replacedUsed: number; keptRow: number; keptUsed: number }> = [];
    for (const row of rows) {
      const key = row.cardNumber.trim();
      if (cardRowMap.has(key)) {
        const replaced = cardRowMap.get(key)!;
        duplicateDetails.push({
          card: key,
          replacedRow: replaced.rowNumber,
          replacedUsed: replaced.usedBalance,
          keptRow: row.rowNumber,
          keptUsed: row.usedBalance,
        });
        duplicateCardCount++;
      }
      cardRowMap.set(key, row);
    }
    const deduplicatedRows = Array.from(cardRowMap.values());
    await reportProgress("categorizing", Math.max(1, rows.length), Math.max(1, Math.round(rows.length * 0.15)), "جارٍ تصنيف الصفوف");

    // ── التحقق من صحة بيانات الملف قبل المتابعة ──
    const dataErrors: string[] = [];
    for (const row of deduplicatedRows) {
      if (row.usedBalance > 0 && row.totalBalance > 0 && row.usedBalance > row.totalBalance) {
        dataErrors.push(`صف ${row.rowNumber}: الرصيد المستخدم (${row.usedBalance}) أكبر من الرصيد الكلي (${row.totalBalance})`);
      }
    }
    if (dataErrors.length > 0) {
      return { error: `أخطاء في بيانات الملف:\n${dataErrors.join("\n")}` };
    }

    const importFacilityId = await resolveImportFacilityId(username, selectedFacilityId);
    // يرجع التحكم للمستخدم في خيار حذف الاستيرادات القديمة
    const replaceOldImports = options?.replaceOldImports !== false;
    const purgeMissingFamiliesEnabled = replaceOldImports && options?.purgeMissingFamilies === true;
    // تفعيل حذف SETTLEMENT القديمة افتراضياً لمنع الخصم المزدوج عند إعادة الاستيراد
    const cleanupOldSettlementsEnabled = replaceOldImports && options?.cleanupOldSettlements !== false;

    // 2. Build lookup
    const lookup = await buildCardLookup();

    // 3. Categorize rows
    const notFoundRows: NotFoundRow[] = [];
    const toImport: Array<{ row: ParsedRow; baseCard: string }> = [];
    const toSuspend: Array<{ row: ParsedRow; baseCard: string }> = [];
    const toSetBalance: Array<{ row: ParsedRow; baseCard: string }> = [];
    const archiveByBaseCard = new Map<string, ParsedRow>();

    for (const row of deduplicatedRows) {
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
          archiveByBaseCard.set(baseCard, row);
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
          archiveByBaseCard.set(baseCard, row);
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
      archiveByBaseCard.set(baseCard, row);
    }

    await reportProgress("categorizing", Math.max(1, rows.length), Math.max(1, Math.round(rows.length * 0.3)), "اكتمل تصنيف الصفوف");

    const targetBaseCards = Array.from(new Set([
      ...toImport.map((x) => x.baseCard),
      ...toSetBalance.map((x) => x.baseCard),
      ...toSuspend.map((x) => x.baseCard),
    ]));

    let cleanupPurgedMissingFamilies = 0;
    let cleanupDeletedMissingFamilyArchiveRows = 0;
    let missingBaseCards: string[] = [];

    if (purgeMissingFamiliesEnabled) {
      await reportProgress("cleanup", Math.max(1, rows.length), Math.max(1, Math.round(rows.length * 0.32)), "جارٍ تحديد عائلات IMPORT غير الموجودة في الملف");
      missingBaseCards = await findImportBaseCardsMissingFromFile(importFacilityId, targetBaseCards);
      cleanupPurgedMissingFamilies = missingBaseCards.length;
    }

    const affectedBaseCards = Array.from(new Set([
      ...targetBaseCards,
      ...missingBaseCards,
    ]));

    const existingImportFamiliesBefore = new Set<string>();
    if (toImport.length > 0) {
      const importBaseCards = Array.from(new Set(toImport.map((x) => x.baseCard)));
      const importFamiliesBeforeRows = await prisma.$queryRaw<Array<{ family_base_card: string }>>`
        SELECT DISTINCT
          regexp_replace(b.card_number, '([WSDMFHV][0-9]*)$', '') AS family_base_card
        FROM "Transaction" t
        JOIN "Beneficiary" b ON b.id = t.beneficiary_id
        WHERE t.type = 'IMPORT'
          AND t.is_cancelled = false
          AND b.deleted_at IS NULL
          AND regexp_replace(b.card_number, '([WSDMFHV][0-9]*)$', '') = ANY(${importBaseCards}::text[])
      `;
      for (const row of importFamiliesBeforeRows) {
        existingImportFamiliesBefore.add(String(row.family_base_card ?? "").trim());
      }
    }

    const snapshotBeforeMembers = affectedBaseCards.length > 0
      ? await loadFamilyMembersSnapshot(affectedBaseCards)
      : [];
    const snapshotBeforeArchive = affectedBaseCards.length > 0
      ? await loadFamilyArchiveSnapshot(affectedBaseCards)
      : [];

    let cleanupDeletedImportTransactions = 0;
    let cleanupDeletedSettlementTransactions = 0;
    let cleanupCancelledImportTransactions = 0;
    let cleanupDeletedCancelledSettlementTransactions = 0;
    let cleanupTouchedBeneficiaries = 0;
    let deletedImportTransactions: DeletedImportTransactionSnapshot[] = [];
    const cleanupAffectedMemberIds = new Set<string>();
    if (replaceOldImports) {
      await reportProgress("cleanup", Math.max(1, rows.length), Math.max(1, Math.round(rows.length * 0.4)), "جارٍ حذف كل IMPORT القديمة فعلياً");
      const cleanup = await cleanupActiveImportsAndRestoreLedgerState();
      cleanupDeletedImportTransactions = cleanup.deletedImportTransactions;
      cleanupCancelledImportTransactions = cleanup.cancelledImportTransactions;
      deletedImportTransactions = cleanup.deletedImportTransactionRows;
      for (const memberId of cleanup.affectedMemberIds) cleanupAffectedMemberIds.add(memberId);

      if (cleanupOldSettlementsEnabled) {
        await reportProgress("cleanup", Math.max(1, rows.length), Math.max(1, Math.round(rows.length * 0.45)), "جارٍ حذف كل تسويات SETTLEMENT القديمة");
        const settlementCleanup = await cleanupAutoSettlementsAndRestoreLedgerState();
        cleanupDeletedSettlementTransactions = settlementCleanup.deletedSettlementTransactions;
        cleanupDeletedCancelledSettlementTransactions = settlementCleanup.deletedCancelledSettlementTransactions;
        for (const memberId of settlementCleanup.affectedMemberIds) cleanupAffectedMemberIds.add(memberId);
      }

      if (cleanupAffectedMemberIds.size > 0) {
        await recalculateBeneficiariesLedgerState(Array.from(cleanupAffectedMemberIds));
      }
      cleanupTouchedBeneficiaries = cleanupAffectedMemberIds.size;

      if (missingBaseCards.length > 0) {
        cleanupDeletedMissingFamilyArchiveRows = await deleteFamilyImportArchiveRows(missingBaseCards);
      }
    }

    let suspendedFamilies = 0;
    let skippedAlreadySuspended = 0;

    for (const { baseCard } of toSuspend) {
      const suspendResult = await suspendFamily(baseCard);
      if (suspendResult === "already_suspended") {
        skippedAlreadySuspended++;
      } else {
        suspendedFamilies++;
      }
      const suspendDone = suspendedFamilies + skippedAlreadySuspended;
      const suspendTotal = Math.max(1, toSuspend.length);
      await reportProgress(
        "suspend",
        Math.max(1, rows.length),
        Math.max(1, Math.round(rows.length * (0.5 + (suspendDone / suspendTotal) * 0.1))),
        `إيقاف الأسر: ${suspendDone}/${toSuspend.length}`,
      );
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
      const balanceDone = balanceSetFamilies + skippedAlreadyCorrect;
      const balanceTotal = Math.max(1, toSetBalance.length);
      await reportProgress(
        "balance",
        Math.max(1, rows.length),
        Math.max(1, Math.round(rows.length * (0.6 + (balanceDone / balanceTotal) * 0.1))),
        `ضبط الأرصدة: ${balanceDone}/${toSetBalance.length}`,
      );
    }

    // 4c. Process imports
    let importedFamilies = 0;
    let importedTransactions = 0;
    const skippedAlreadyImported = 0;
    let updatedFamilies = 0;
    let updatedTransactions = 0;
    let preImportBalanceAdjustedFamilies = 0;
    let preImportBalanceAlreadyCorrect = 0;
    const appliedRows: ImportAppliedRow[] = [];

    for (const { row, baseCard } of toImport) {
      const hadExistingImportBefore = existingImportFamiliesBefore.has(baseCard);

      // إذا كان هناك رصيد كلي بالملف، يجب ضبط رصيد الأسرة أولاً
      // ثم تطبيق الخصم (usedBalance) حتى لا نعتمد على أرصدة قديمة.
      if (row.totalBalance > 0) {
        const setResult = await setFamilyBalance(baseCard, row.totalBalance, row.familyCount);
        if (setResult === "already_correct") {
          preImportBalanceAlreadyCorrect++;
        } else {
          preImportBalanceAdjustedFamilies++;
        }
      }

      const familyResult = await importFamilyTransactions(
        baseCard,
        row.usedBalance,
        importFacilityId,
        row.familyCount,
        replaceOldImports,
      );
      appliedRows.push(...familyResult.appliedRows);

      if (hadExistingImportBefore) {
        updatedFamilies++;
        updatedTransactions += familyResult.count;
      } else {
        importedFamilies++;
        importedTransactions += familyResult.count;
      }

      const importDone = importedFamilies + updatedFamilies;
      const importTotal = Math.max(1, toImport.length);
      await reportProgress(
        "import",
        Math.max(1, rows.length),
        Math.max(1, Math.round(rows.length * (0.7 + (importDone / importTotal) * 0.25))),
        `تطبيق خصم الاستيراد: ${importDone}/${toImport.length}`,
      );
    }

    // حفظ أرشيف القيم بعد اكتمال الاستيراد الفعلي (آمنة: لا تُدوَّن بيانات لم تُستورد بعد)
    for (const [baseCard, row] of archiveByBaseCard.entries()) {
      await upsertFamilyImportArchive({
        familyBaseCard: baseCard,
        familyCount: row.familyCount,
        totalBalanceFromFile: row.totalBalance,
        usedBalanceFromFile: row.usedBalance,
        sourceRowNumber: row.rowNumber,
        importedBy: username,
      });
    }
    await reportProgress("cleanup", Math.max(1, rows.length), Math.max(1, Math.round(rows.length * 0.93)), "تم حفظ أرشيف الاستيراد");

    await reportProgress("audit", Math.max(1, rows.length), Math.max(1, Math.round(rows.length * 0.97)), "جارٍ حفظ سجل المراقبة");

    const snapshotAfterMembers = affectedBaseCards.length > 0
      ? await loadFamilyMembersSnapshot(affectedBaseCards)
      : [];
    const snapshotAfterArchive = affectedBaseCards.length > 0
      ? await loadFamilyArchiveSnapshot(affectedBaseCards)
      : [];

    const detailedReport: ImportDetailedReport = {
      snapshotBefore: {
        affectedFamilies: affectedBaseCards,
        affectedMembersCount: snapshotBeforeMembers.length,
        members: snapshotBeforeMembers,
        familyArchiveBefore: snapshotBeforeArchive,
      },
      cleanup: {
        mode: "hard_delete",
        deletedImportTransactionsCount: cleanupDeletedImportTransactions,
        deletedImportTransactions,
        touchedBeneficiaries: cleanupTouchedBeneficiaries,
      },
      execution: {
        appliedRows,
      },
      snapshotAfter: {
        members: snapshotAfterMembers,
        familyArchiveAfter: snapshotAfterArchive,
      },
      rollbackSnapshot: {
        affectedFamilies: affectedBaseCards,
        affectedMemberIds: Array.from(new Set(snapshotBeforeMembers.map((m) => m.beneficiaryId))),
        membersBefore: snapshotBeforeMembers,
        deletedOldImportTransactions: deletedImportTransactions,
        familyArchiveBefore: snapshotBeforeArchive,
      },
    };

    // 5. Audit log — كتابة واحدة بدون create ثم update
    const autoDebtAffectedDebtors = 0;
    const autoDebtSettledDebtors = 0;
    const autoDebtUnresolvedDebtors = 0;

    const auditLog = await prisma.auditLog.create({
      data: {
        facility_id: importFacilityId,
        user: username,
        action: "IMPORT_TRANSACTIONS",
        metadata: {
          importMode: replaceOldImports ? "replace_old_imports" : "incremental_update",
          purgeMissingFamiliesEnabled,
          cleanupOldSettlementsEnabled,
          cleanupPurgedMissingFamilies,
          cleanupDeletedMissingFamilyArchiveRows,
          cleanupMode: "hard_delete",
          cleanupDeletedImportTransactions,
          cleanupDeletedSettlementTransactions,
          cleanupCancelledImportTransactions,
          cleanupDeletedCancelledSettlementTransactions,
          cleanupTouchedBeneficiaries,
          totalRows: rows.length,
          duplicateCardCount,
          duplicateDetails,
          importedFamilies,
          importedTransactions,
          suspendedFamilies,
          skippedAlreadySuspended,
          balanceSetFamilies,
          skippedAlreadyCorrect,
          preImportBalanceAdjustedFamilies,
          preImportBalanceAlreadyCorrect,
          skippedNotFound: notFoundRows.length,
          skippedAlreadyImported,
          updatedFamilies,
          updatedTransactions,
          appliedRows,
          detailedReport,
          autoDebtSettlement: {
            status: "deferred_manual",
          },
          rollbackEligible: true,
          rollbackStatus: "not_rolled_back",
        },
      },
    });

    await reportProgress("done", Math.max(1, rows.length), Math.max(1, rows.length), "اكتمل الاستيراد بنجاح");

    return {
      result: {
        auditLogId: auditLog.id,
        importMode: replaceOldImports ? "replace_old_imports" : "incremental_update",
        purgeMissingFamiliesEnabled,
        cleanupOldSettlementsEnabled,
        cleanupPurgedMissingFamilies,
        cleanupDeletedMissingFamilyArchiveRows,
        cleanupDeletedImportTransactions,
        cleanupDeletedSettlementTransactions,
        cleanupCancelledImportTransactions,
        cleanupDeletedCancelledSettlementTransactions,
        cleanupTouchedBeneficiaries,
        totalRows: rows.length,
        duplicateCardCount,
        importedFamilies,
        importedTransactions,
        updatedFamilies,
        updatedTransactions,
        suspendedFamilies,
        skippedAlreadySuspended,
        balanceSetFamilies,
        skippedAlreadyCorrect,
        preImportBalanceAdjustedFamilies,
        preImportBalanceAlreadyCorrect,
        skippedNotFound: notFoundRows.length,
        skippedAlreadyImported,
        autoDebtAffectedDebtors,
        autoDebtSettledDebtors,
        autoDebtUnresolvedDebtors,
        notFoundRows,
        detailedReport,
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "حدث خطأ غير متوقع أثناء معالجة الملف." };
  }
}

async function cleanupActiveImportsAndRestoreLedgerState(): Promise<{
  deletedImportTransactions: number;
  cancelledImportTransactions: number;
  affectedMemberIds: string[];
  deletedImportTransactionRows: DeletedImportTransactionSnapshot[];
}> {
  return await prisma.$transaction(async (tx) => {
    const existingImportRows = await tx.$queryRaw<ImportTxRow[]>`
      SELECT
        id,
        beneficiary_id,
        facility_id,
        amount::float8 AS amount,
        type::text AS type,
        is_cancelled,
        created_at,
        original_transaction_id,
        idempotency_key
      FROM "Transaction"
      WHERE type = 'IMPORT'
      ORDER BY created_at ASC, id ASC
    `;

    const deletedImportTransactionRows: DeletedImportTransactionSnapshot[] = existingImportRows.map((row) => ({
      id: row.id,
      beneficiaryId: row.beneficiary_id,
      facilityId: row.facility_id,
      amount: Number(row.amount) || 0,
      type: "IMPORT",
      isCancelled: Boolean(row.is_cancelled),
      createdAt: row.created_at.toISOString(),
      originalTransactionId: row.original_transaction_id,
      idempotencyKey: row.idempotency_key,
    }));

    if (deletedImportTransactionRows.length > 0) {
      await tx.transaction.deleteMany({
        where: {
          id: { in: deletedImportTransactionRows.map((t) => t.id) },
        },
      });
    }

    return {
      deletedImportTransactions: deletedImportTransactionRows.length,
      cancelledImportTransactions: deletedImportTransactionRows.length,
      affectedMemberIds: Array.from(new Set(deletedImportTransactionRows.map((t) => t.beneficiaryId))),
      deletedImportTransactionRows,
    };
  }, INTERACTIVE_TX_OPTIONS);
}

async function cleanupAutoSettlementsAndRestoreLedgerState(): Promise<{
  deletedSettlementTransactions: number;
  deletedCancelledSettlementTransactions: number;
  affectedMemberIds: string[];
}> {
  return await prisma.$transaction(async (tx) => {
    const settlementRows = await tx.$queryRaw<Array<{ id: string; is_cancelled: boolean; beneficiary_id: string }>>`
      SELECT t.id, t.is_cancelled, t.beneficiary_id
      FROM "Transaction" t
      WHERE t.type::text = 'SETTLEMENT'
    `;

    const deletedCancelledSettlementTransactions = settlementRows.filter((row) => Boolean(row.is_cancelled)).length;

    if (settlementRows.length > 0) {
      await tx.transaction.deleteMany({
        where: {
          id: { in: settlementRows.map((row) => row.id) },
        },
      });
    }

    return {
      deletedSettlementTransactions: settlementRows.length,
      deletedCancelledSettlementTransactions,
      affectedMemberIds: Array.from(new Set(settlementRows.map((row) => row.beneficiary_id))),
    };
  }, INTERACTIVE_TX_OPTIONS);
}

async function recalculateBeneficiariesLedgerState(memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;

  await prisma.$executeRaw`
    WITH deduction AS (
      SELECT
        t.beneficiary_id,
        COALESCE(SUM(t.amount), 0)::numeric AS deducted
      FROM "Transaction" t
      WHERE t.beneficiary_id = ANY(${memberIds}::text[])
        AND t.is_cancelled = false
        AND t.type <> 'CANCELLATION'
      GROUP BY t.beneficiary_id
    )
    UPDATE "Beneficiary" b
    SET
      remaining_balance = ROUND(LEAST(b.total_balance, GREATEST(0::numeric, b.total_balance - COALESCE(d.deducted, 0::numeric))), 2),
      status = CASE
        WHEN ROUND(LEAST(b.total_balance, GREATEST(0::numeric, b.total_balance - COALESCE(d.deducted, 0::numeric))), 2) <= 0
          THEN 'FINISHED'::"BeneficiaryStatus"
        ELSE 'ACTIVE'::"BeneficiaryStatus"
      END,
      completed_via = CASE
        WHEN ROUND(LEAST(b.total_balance, GREATEST(0::numeric, b.total_balance - COALESCE(d.deducted, 0::numeric))), 2) <= 0
          THEN 'DEDUCTION'
        ELSE NULL
      END
    FROM deduction d
    WHERE b.id = ANY(${memberIds}::text[])
      AND b.id = d.beneficiary_id
  `;

  await prisma.$executeRaw`
    UPDATE "Beneficiary" b
    SET
      remaining_balance = ROUND(GREATEST(0::numeric, b.total_balance), 2),
      status = CASE
        WHEN ROUND(GREATEST(0::numeric, b.total_balance), 2) <= 0
          THEN 'FINISHED'::"BeneficiaryStatus"
        ELSE 'ACTIVE'::"BeneficiaryStatus"
      END,
      completed_via = CASE
        WHEN ROUND(GREATEST(0::numeric, b.total_balance), 2) <= 0
          THEN 'DEDUCTION'
        ELSE NULL
      END
    WHERE b.id = ANY(${memberIds}::text[])
      AND NOT EXISTS (
        SELECT 1
        FROM "Transaction" t
        WHERE t.beneficiary_id = b.id
          AND t.is_cancelled = false
          AND t.type <> 'CANCELLATION'
      )
  `;
}

async function loadFamilyMembersSnapshot(baseCards: string[]): Promise<BeneficiaryBalanceSnapshot[]> {
  if (baseCards.length === 0) return [];
  const dedup = new Map<string, BeneficiaryBalanceSnapshot>();
  const familyRegex = buildFamilyBaseRegex(baseCards);

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    card_number: string;
    total_balance: number;
    remaining_balance: number;
    status: string;
    completed_via: string | null;
  }>>`
    SELECT
      b.id,
      b.name,
      b.card_number,
      b.total_balance::float8 AS total_balance,
      b.remaining_balance::float8 AS remaining_balance,
      b.status::text AS status,
      b.completed_via
    FROM "Beneficiary" b
    WHERE b.deleted_at IS NULL
      AND b.card_number ~ ${familyRegex}
    ORDER BY b.card_number ASC, b.id ASC
  `;

  for (const row of rows) {
    dedup.set(row.id, {
      beneficiaryId: row.id,
      beneficiaryName: row.name,
      cardNumber: row.card_number,
      totalBalance: Number(row.total_balance) || 0,
      remainingBalance: Number(row.remaining_balance) || 0,
      status: (String(row.status || "ACTIVE") as "ACTIVE" | "FINISHED" | "SUSPENDED"),
      completedVia: row.completed_via,
    });
  }

  return Array.from(dedup.values()).sort((a, b) => a.cardNumber.localeCompare(b.cardNumber));
}

async function loadFamilyArchiveSnapshot(baseCards: string[]): Promise<FamilyImportArchiveSnapshot[]> {
  if (baseCards.length === 0) return [];

  const rows = await prisma.$queryRaw<Array<{
    family_base_card: string;
    family_count_from_file: number;
    total_balance_from_file: number;
    used_balance_from_file: number;
    source_row_number: number | null;
    imported_by: string | null;
    last_imported_at: Date;
    created_at: Date;
    updated_at: Date;
  }>>`
    SELECT
      family_base_card,
      family_count_from_file,
      total_balance_from_file::float8 AS total_balance_from_file,
      used_balance_from_file::float8 AS used_balance_from_file,
      source_row_number,
      imported_by,
      last_imported_at,
      created_at,
      updated_at
    FROM "FamilyImportArchive"
    WHERE family_base_card = ANY(${baseCards}::text[])
    ORDER BY family_base_card ASC
  `;

  return rows.map((row) => ({
    familyBaseCard: row.family_base_card,
    familyCountFromFile: Number(row.family_count_from_file) || 0,
    totalBalanceFromFile: Number(row.total_balance_from_file) || 0,
    usedBalanceFromFile: Number(row.used_balance_from_file) || 0,
    sourceRowNumber: row.source_row_number,
    importedBy: row.imported_by,
    lastImportedAt: row.last_imported_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

async function deleteFamilyImportArchiveRows(baseCards: string[]): Promise<number> {
  if (baseCards.length === 0) return 0;
  const deleted = await prisma.$executeRaw`
    DELETE FROM "FamilyImportArchive"
    WHERE family_base_card = ANY(${baseCards}::text[])
  `;
  return Number(deleted) || 0;
}

async function findImportBaseCardsMissingFromFile(importFacilityId: string, keepBaseCards: string[]): Promise<string[]> {
  const keepSet = new Set(keepBaseCards.map((x) => String(x ?? "").trim()).filter(Boolean));

  const rows = await prisma.$queryRaw<Array<{ family_base_card: string }>>`
    SELECT DISTINCT
      regexp_replace(b.card_number, '(?:[DWSH]\\d+|[MF]\\d*)$', '', 'i') AS family_base_card
    FROM "Transaction" t
    JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    WHERE t.type = 'IMPORT'
      AND t.is_cancelled = false
      AND t.facility_id = ${importFacilityId}
      AND b.deleted_at IS NULL
  `;

  return rows
    .map((r) => String(r.family_base_card ?? "").trim().toUpperCase())
    .filter((baseCard) => /^WAB2025\d+$/.test(baseCard))
    .filter((baseCard) => !keepSet.has(baseCard));
}

async function ensureFamilyImportArchiveTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FamilyImportArchive" (
      "family_base_card" TEXT PRIMARY KEY,
      "family_count_from_file" INTEGER NOT NULL DEFAULT 0,
      "total_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
      "used_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
      "source_row_number" INTEGER,
      "imported_by" TEXT,
      "last_imported_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_family_import_archive_last_imported_at"
    ON "FamilyImportArchive" ("last_imported_at" DESC);
  `);
}

async function upsertFamilyImportArchive(input: {
  familyBaseCard: string;
  familyCount: number;
  totalBalanceFromFile: number;
  usedBalanceFromFile: number;
  sourceRowNumber: number;
  importedBy: string;
}) {
  await prisma.$executeRaw`
    INSERT INTO "FamilyImportArchive" (
      "family_base_card",
      "family_count_from_file",
      "total_balance_from_file",
      "used_balance_from_file",
      "source_row_number",
      "imported_by",
      "last_imported_at",
      "updated_at"
    )
    VALUES (
      ${input.familyBaseCard},
      ${Math.max(0, Math.floor(Number(input.familyCount) || 0))},
      ${roundCurrency(Number(input.totalBalanceFromFile) || 0)},
      ${roundCurrency(Number(input.usedBalanceFromFile) || 0)},
      ${Math.max(0, Math.floor(Number(input.sourceRowNumber) || 0))},
      ${input.importedBy},
      NOW(),
      NOW()
    )
    ON CONFLICT ("family_base_card")
    DO UPDATE SET
      "family_count_from_file" = EXCLUDED."family_count_from_file",
      "total_balance_from_file" = EXCLUDED."total_balance_from_file",
      "used_balance_from_file" = EXCLUDED."used_balance_from_file",
      "source_row_number" = EXCLUDED."source_row_number",
      "imported_by" = EXCLUDED."imported_by",
      "last_imported_at" = NOW(),
      "updated_at" = NOW();
  `;
}

// ─── Family Import ───────────────────────────────────────────────

async function importFamilyTransactions(
  baseCard: string,
  totalUsedAmount: number,
  facilityId: string,
  expectedFamilyCount?: number,
  replaceOldImports = true,
): Promise<{ count: number; mode: "created" | "updated"; appliedRows: ImportAppliedRow[] }> {
  let transactionCount = 0;
  const appliedRows: ImportAppliedRow[] = [];
  let hasExistingImport = false;

  await prisma.$transaction(async (tx) => {
    // 1. قفل صفوف أعضاء العائلة لمنع race condition مع خصم يدوي متزامن
    const familyMembers = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; total_balance: number; status: string }>>`
      SELECT id, name, card_number, remaining_balance, total_balance, status
      FROM "Beneficiary"
      WHERE (
        card_number = ${baseCard}
        OR card_number ~ ${familySuffixRegex(baseCard)}
      )
        AND "deleted_at" IS NULL
      ORDER BY card_number ASC
      FOR UPDATE
    `;

    if (familyMembers.length === 0) {
      return;
    }

    const memberIds = familyMembers.map((m) => m.id);

    // البحث عن أي حركة استيراد سابقة بغض النظر عن المرفق لمنع التكرار
    const existingImports = await tx.transaction.findMany({
      where: {
        beneficiary_id: { in: memberIds },
        type: TransactionType.IMPORT,
        is_cancelled: false,
      },
      select: { id: true, beneficiary_id: true, amount: true },
      orderBy: { created_at: "asc" },
    });
    hasExistingImport = existingImports.length > 0;

    // توزيع بدون كسور: المبلغ الصحيح بالتساوي، والمتبقي يُسند لصاحب أعلى رصيد متاح.
    // عند توفر عدد الأسرة من الملف نوزّع على هذا العدد لمنع تضخيم حصة الموجودين فعلياً.
    const expectedCount = Math.max(0, Math.floor(Number(expectedFamilyCount) || 0));
    const divisor = Math.max(1, expectedCount > 0 ? expectedCount : familyMembers.length);
    const normalizedTotalUsed = Math.max(0, Math.round(totalUsedAmount));
    const baseShare = Math.floor(normalizedTotalUsed / divisor);
    const remainder = normalizedTotalUsed - baseShare * divisor;

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
    const preCalcs = familyMembers.map((member) => {
      const currentBalance = Number(member.remaining_balance);
      const existingForMember = importsByMember.get(member.id) ?? [];
      const previousImported = existingForMember.reduce((sum, item) => sum + Number(item.amount), 0);
      // في وضع الاستبدال: نرجع إلى الرصيد قبل IMPORT ثم نعيد حسابه.
      // في الوضع التراكمي: نكمل خصمًا من الرصيد الحالي فقط.
      const balanceBeforeImport = replaceOldImports
        ? roundCurrency(currentBalance + previousImported)
        : roundCurrency(currentBalance);
      return { member, existingForMember, balanceBeforeImport };
    });

    const remainderRecipientIndex = chooseRemainderRecipientIndex(
      preCalcs.map((c) => ({
        status: String(c.member.status ?? ""),
        availableBalance: c.balanceBeforeImport,
      })),
      remainder,
    );

    const calcs: MemberCalc[] = [];

    for (let i = 0; i < familyMembers.length; i++) {
      const { member, existingForMember, balanceBeforeImport } = preCalcs[i];
      const plannedDeductAmount = i === remainderRecipientIndex ? baseShare + remainder : baseShare;
      // شرط دقة الاستيراد: لا خصم نهائياً إذا كان الرصيد صفراً أو أقل من الحصة المطلوبة.
      const deductAmount = balanceBeforeImport > 0 && balanceBeforeImport >= plannedDeductAmount
        ? plannedDeductAmount
        : 0;
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
        familySize: divisor,
        balanceBefore: balanceBeforeImport,
        deductedAmount: deductAmount,
        familyTotalDeduction: normalizedTotalUsed,
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
        const newAmount = replaceOldImports
          ? deductAmount
          : roundCurrency(Number(existingForMember[0].amount || 0) + deductAmount);

        await tx.transaction.update({
          where: { id: existingForMember[0].id },
          data: { amount: newAmount },
        });

        if (existingForMember.length > 1) {
          await tx.transaction.deleteMany({
            where: { id: { in: existingForMember.slice(1).map((item) => item.id) } },
          });
        }
      }

      transactionCount++;
    }
  }, INTERACTIVE_TX_OPTIONS);

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
  const familyMembers = await prisma.$queryRaw<Array<{ id: string; status: string; total_balance: number }>>`
    SELECT id, status::text, total_balance::float8
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND (
        card_number = ${baseCard}
        OR card_number ~ ${familySuffixRegex(baseCard)}
      )
    ORDER BY card_number ASC
  `;

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
  // كل العمليات داخل transaction واحد لضمان الذرية (atomicity)
  // ومنع فقدان البيانات عند فشل أي خطوة
  return await prisma.$transaction(async (tx) => {
    // قفل صفوف العائلة بـ FOR UPDATE لمنع race condition مع خصم يدوي متزامن
    const familyMembers = await tx.$queryRaw<Array<{ id: string; status: string; total_balance: number; remaining_balance: number }>>`
      SELECT id, status::text, total_balance::float8, remaining_balance::float8
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND (
          card_number = ${baseCard}
          OR card_number ~ ${familySuffixRegex(baseCard)}
        )
      ORDER BY card_number ASC
      FOR UPDATE
    `;

    if (familyMembers.length === 0) return "already_correct";

    // عند توفر عدد الأسرة من الملف نوزّع على هذا العدد لمنع تضخيم حصة الموجودين فعلياً.
    const expectedCount = Math.max(0, Math.floor(Number(expectedFamilyCount) || 0));
    const divisor = Math.max(1, expectedCount > 0 ? expectedCount : familyMembers.length);
    const normalizedTotalBalance = Math.max(0, Math.round(totalBalance));
    const baseShare = Math.floor(normalizedTotalBalance / divisor);
    const remainder = normalizedTotalBalance - baseShare * divisor;
    const remainderRecipientIndex = chooseRemainderRecipientIndex(
      familyMembers.map((m) => ({
        status: String(m.status ?? ""),
        availableBalance: Number(m.remaining_balance),
      })),
      remainder,
    );
    const memberIds = familyMembers.map((m) => m.id);

    // تنظيف حركات IMPORT القديمة داخل الـ transaction — آمن عند الفشل
    await tx.transaction.deleteMany({
      where: {
        beneficiary_id: { in: memberIds },
        type: "IMPORT",
        is_cancelled: false,
      },
    });

    // حساب الخصومات اليدوية (MEDICINE / SUPPLIES) لكل عضو لحمايتها عند إعادة الضبط
    const manualDeductions = await tx.transaction.groupBy({
      by: ['beneficiary_id'],
      where: {
        beneficiary_id: { in: memberIds },
        type: { notIn: [TransactionType.IMPORT, TransactionType.CANCELLATION] },
        is_cancelled: false,
      },
      _sum: { amount: true },
    });

    const deductionMap = new Map<string, number>();
    for (const d of manualDeductions) {
      deductionMap.set(d.beneficiary_id, Number(d._sum.amount) || 0);
    }

    // Check if already correct (مع مراعاة الخصومات اليدوية)
    const alreadyCorrect = familyMembers.every((m, i) => {
      const expectedShare = i === remainderRecipientIndex ? baseShare + remainder : baseShare;
      const manualDed = deductionMap.get(m.id) || 0;
      const expectedRemaining = roundCurrency(Math.max(0, expectedShare - manualDed));
      const expectedStatus = expectedRemaining <= 0 ? "FINISHED" : "ACTIVE";
      return (
        m.status === expectedStatus &&
        Number(m.total_balance) === expectedShare &&
        Number(m.remaining_balance) === expectedRemaining
      );
    });
    if (alreadyCorrect) return "already_correct";

    // توزيع الرصيد مع حماية الخصومات اليدوية
    for (let i = 0; i < familyMembers.length; i++) {
      const member = familyMembers[i];
      const share = i === remainderRecipientIndex ? baseShare + remainder : baseShare;
      const manualDed = deductionMap.get(member.id) || 0;
      const remaining = roundCurrency(Math.max(0, share - manualDed));
      const newStatus = remaining <= 0 ? "FINISHED" : "ACTIVE";
      await tx.beneficiary.update({
        where: { id: member.id },
        data: {
          total_balance: share,
          remaining_balance: remaining,
          status: newStatus as "ACTIVE" | "FINISHED",
          completed_via: newStatus === "FINISHED" ? "DEDUCTION" : null,
        },
      });
    }

    return { count: familyMembers.length };
  }, INTERACTIVE_TX_OPTIONS);
}

function chooseRemainderRecipientIndex(
  recipients: Array<{ status: string; availableBalance: number }>,
  remainder: number,
): number {
  if (recipients.length === 0) return 0;
  if (remainder <= 0) return 0;

  let bestIndex = 0;
  let bestIsActive = false;
  let bestHasBalance = false;
  let bestBalance = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const isActive = recipient.status === "ACTIVE";
    const balance = Number(recipient.availableBalance ?? 0);
    const hasBalance = balance > 0;

    // الأولوية: ACTIVE + لديه رصيد أولاً، ثم ACTIVE، ثم الأعلى رصيداً.
    if (
      (isActive && hasBalance && !(bestIsActive && bestHasBalance)) ||
      (isActive === bestIsActive && hasBalance && !bestHasBalance) ||
      (isActive === bestIsActive && hasBalance === bestHasBalance && balance > bestBalance)
    ) {
      bestIsActive = isActive;
      bestHasBalance = hasBalance;
      bestBalance = balance;
      bestIndex = i;
    }
  }

  return bestIndex;
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
