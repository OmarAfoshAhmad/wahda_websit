import { TransactionType } from "@prisma/client";

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
  autoCreatedBeneficiaries: number;
  autoDebtAffectedDebtors: number;
  autoDebtSettledDebtors: number;
  autoDebtUnresolvedDebtors: number;
  notFoundRows: NotFoundRow[];
  detailedReport: ImportDetailedReport;
};

export type BeneficiaryBalanceSnapshot = {
  beneficiaryId: string;
  beneficiaryName: string;
  cardNumber: string;
  totalBalance: number;
  remainingBalance: number;
  status: "ACTIVE" | "FINISHED" | "SUSPENDED";
  completedVia: string | null;
};

export type DeletedImportTransactionSnapshot = {
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

export type FamilyImportArchiveSnapshot = {
  familyBaseCard: string;
  familyCountFromFile: number | null;
  totalBalanceFromFile: number;
  usedBalanceFromFile: number;
  sourceRowNumber: number | null;
  importedBy: string;
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

export type ImportAppliedRow = {
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

export type ImportTxRow = {
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

export type ParsedRow = {
  rowNumber: number;
  cardNumber: string;
  name: string;
  familyCount: number;
  totalBalance: number;
  usedBalance: number;
};

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
