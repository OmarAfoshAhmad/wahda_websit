import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";
import {
  TransactionImportResult,
  TransactionImportPurgePreview,
  TransactionImportProgress,
  NotFoundRow,
  ParsedRow,
  ImportAppliedRow,
  DeletedImportTransactionSnapshot,
  ImportDetailedReport
} from "./types";
import {
  buildCardLookup,
  resolveCardNumber,
} from "./utils";
import {
  parseExcelRows,
  resolveImportFacilityId,
} from "./validation";
import {
  loadFamilyArchiveSnapshot,
  deleteFamilyImportArchiveRows,
  findImportBaseCardsMissingFromFile,
  upsertFamilyImportArchive
} from "./archive";
import {
  cleanupActiveImportsAndRestoreLedgerState,
  cleanupAutoSettlementsAndRestoreLedgerState,
  recalculateBeneficiariesLedgerState
} from "./rollback";
import {
  loadFamilyMembersSnapshot,
  importFamilyTransactions,
  suspendFamily,
  setFamilyBalance
} from "./migration";

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

export async function processTransactionImport(
  fileBuffer: Buffer,
  username: string,
  selectedFacilityId?: string,
  options?: {
    replaceOldImports?: boolean;
    purgeMissingFamilies?: boolean;
    cleanupOldSettlements?: boolean;
    sourceFileName?: string;
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


    // 1. Parse file
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(fileBuffer as any);
    const rows = parseExcelRows(workbook);
    await reportProgress("parsing", Math.max(1, rows.length), 1, "تم تحليل ملف Excel");

    if (rows.length === 0) {
      return { error: "الملف لا يحتوي على بيانات." };
    }

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
    const replaceOldImports = options?.replaceOldImports !== false;
    const purgeMissingFamiliesEnabled = replaceOldImports && options?.purgeMissingFamilies === true;
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

    const autoDebtAffectedDebtors = 0;
    const autoDebtSettledDebtors = 0;
    const autoDebtUnresolvedDebtors = 0;

    const auditLog = await prisma.auditLog.create({
      data: {
        facility_id: importFacilityId,
        user: username,
        action: "IMPORT_TRANSACTIONS",
        metadata: {
          sourceFileName: options?.sourceFileName,
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
