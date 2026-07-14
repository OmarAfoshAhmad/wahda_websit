/**
 * ثوابت النظام المركزية — single source of truth لجميع القيم الثابتة
 * يُغني عن تكرار الـ magic strings في الملفات المختلفة
 */

// ─── أنواع الحركات ───────────────────────────────────────────────────────────
export const TX_TYPES = {
  MEDICINE: "MEDICINE",
  SUPPLIES: "SUPPLIES",
  IMPORT: "IMPORT",
  SETTLEMENT: "SETTLEMENT",
  CANCELLATION: "CANCELLATION",
} as const;

export type TxType = (typeof TX_TYPES)[keyof typeof TX_TYPES];

// ─── تسميات أنواع الحركات (للعرض) ───────────────────────────────────────────
export const TX_TYPE_LABELS: Record<TxType, string> = {
  MEDICINE: "ادوية صرف عام",
  SUPPLIES: "كشف عام",
  IMPORT: "استيراد",
  SETTLEMENT: "تسوية",
  CANCELLATION: "—",
};

// ─── حالات المستفيدين ─────────────────────────────────────────────────────────
export const BENEFICIARY_STATUS = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  FINISHED: "FINISHED",
} as const;

export type BeneficiaryStatus = (typeof BENEFICIARY_STATUS)[keyof typeof BENEFICIARY_STATUS];

export const BENEFICIARY_STATUS_LABELS: Record<BeneficiaryStatus, string> = {
  ACTIVE: "نشط",
  SUSPENDED: "موقوف",
  FINISHED: "مكتمل",
};

// ─── مصدر اكتمال المستفيد ─────────────────────────────────────────────────────
export const COMPLETED_VIA = {
  MANUAL: "MANUAL",
  IMPORT: "IMPORT",
} as const;

export type CompletedVia = (typeof COMPLETED_VIA)[keyof typeof COMPLETED_VIA];

// ─── حالة الحركة (للعرض) ─────────────────────────────────────────────────────
export const TX_STATUS_LABELS = {
  EXECUTED: "منفذة",
  CANCELLED: "ملغاة",
  DELETED: "محذوفة",
  CORRECTED: "حركة مصححة",
  CORRECTED_UNLINKED: "حركة مصححة غير مرتبطة",
} as const;

// ─── حدود الترقيم ─────────────────────────────────────────────────────────────
export const ALLOWED_PAGE_SIZES = [10, 25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_DATE_RANGE_DAYS = 30;

// ─── حدود الاستيراد والتصدير ──────────────────────────────────────────────────
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_FILE_SIZE_MB = 10;
export const MAX_EXPORT_ROWS = 50_000;

// ─── إجراءات سجل التدقيق ─────────────────────────────────────────────────────
export const AUDIT_ACTIONS = {
  // ─── مستفيدون ─────────────────────────────────────────────────────────────
  CREATE_BENEFICIARY: "CREATE_BENEFICIARY",
  UPDATE_BENEFICIARY: "UPDATE_BENEFICIARY",
  IMPORT_BENEFICIARIES_BACKGROUND: "IMPORT_BENEFICIARIES_BACKGROUND",
  DELETE_BENEFICIARY: "DELETE_BENEFICIARY",
  PERMANENT_DELETE_BENEFICIARY: "PERMANENT_DELETE_BENEFICIARY",
  RESTORE_BENEFICIARY: "RESTORE_BENEFICIARY",
  MERGE_DUPLICATE_BENEFICIARY: "MERGE_DUPLICATE_BENEFICIARY",
  UNDO_MERGE_DUPLICATE_BENEFICIARY: "UNDO_MERGE_DUPLICATE_BENEFICIARY",
  // ─── حركات ────────────────────────────────────────────────────────────────
  DEDUCT_BALANCE: "DEDUCT_BALANCE",
  EDIT_TRANSACTION: "EDIT_TRANSACTION",
  CANCEL_TRANSACTION: "CANCEL_TRANSACTION",
  REVERT_CANCELLATION: "REVERT_CANCELLATION",
  SOFT_DELETE_TRANSACTION: "SOFT_DELETE_TRANSACTION",
  RESTORE_SOFT_DELETED_TRANSACTION: "RESTORE_SOFT_DELETED_TRANSACTION",
  PERMANENT_DELETE_TRANSACTION: "PERMANENT_DELETE_TRANSACTION",
  BULK_CANCEL_TRANSACTION: "BULK_CANCEL_TRANSACTION",
  BULK_REDEDUCT_TRANSACTION: "BULK_REDEDUCT_TRANSACTION",
  BULK_DELETE_BENEFICIARY: "BULK_DELETE_BENEFICIARY",
  BULK_PERMANENT_DELETE_BENEFICIARY: "BULK_PERMANENT_DELETE_BENEFICIARY",
  BULK_RESTORE_BENEFICIARY: "BULK_RESTORE_BENEFICIARY",
  BULK_RENEW_BALANCE: "BULK_RENEW_BALANCE",
  UNDO_BULK_RENEW_BALANCE: "UNDO_BULK_RENEW_BALANCE",
  UNDO_BULK_DELETE_BENEFICIARY: "UNDO_BULK_DELETE_BENEFICIARY",
  UNDO_BULK_RESTORE_BENEFICIARY: "UNDO_BULK_RESTORE_BENEFICIARY",
  IMPORT_TRANSACTIONS: "IMPORT_TRANSACTIONS",
  SETTLE_OVERDRAWN_FAMILY_DEBT: "SETTLE_OVERDRAWN_FAMILY_DEBT",
  ROLLBACK_IMPORT: "ROLLBACK_IMPORT",
  // ─── مرافق ────────────────────────────────────────────────────────────────
  CREATE_FACILITY: "CREATE_FACILITY",
  IMPORT_FACILITIES: "IMPORT_FACILITIES",
  UPDATE_FACILITY: "UPDATE_FACILITY",
  DELETE_FACILITY: "DELETE_FACILITY",
  // ─── أمان وجلسات ──────────────────────────────────────────────────────────
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  CHANGE_PASSWORD: "CHANGE_PASSWORD",
  // ─── إدارة وصلاحيات ───────────────────────────────────────────────────────
  CREATE_MANAGER: "CREATE_MANAGER",
  UPDATE_MANAGER: "UPDATE_MANAGER",
  DELETE_MANAGER: "DELETE_MANAGER",
  // ─── صحة الرصيد ───────────────────────────────────────────────────────────
  BALANCE_DRIFT_FIX: "BALANCE_DRIFT_FIX",
  STATUS_ANOMALIES_FIX: "STATUS_ANOMALIES_FIX",
  DATA_HYGIENE_SWEEP: "DATA_HYGIENE_SWEEP",
  FIX_PARENT_CARD_PATTERNS: "FIX_PARENT_CARD_PATTERNS",
  UNDO_FIX_PARENT_CARD_PATTERNS: "UNDO_FIX_PARENT_CARD_PATTERNS",
  NORMALIZE_IMPORT_INTEGER_DISTRIBUTION: "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
  UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION: "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
  FIX_INVALID_SUBUNIT_AMOUNTS: "FIX_INVALID_SUBUNIT_AMOUNTS",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
