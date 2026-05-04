export type DataHygieneMode =
  | "all"
  | "unlinked_corrections"
  | "duplicate_movements"
  | "invalid_password_facilities"
  | "deleted_facilities"
  | "orphaned_notifications"
  | "old_read_notifications"
  | "old_login_audit_logs"
  | "old_import_jobs"
  | "old_restore_jobs";

export type DataHygieneSweepResult = {
  success: boolean;
  dryRun: boolean;
  mode: DataHygieneMode;
  unlinked_corrections: number;
  duplicate_movements: number;
  invalid_password_facilities: number;
  deleted_facilities: number;
  orphaned_notifications: number;
  old_read_notifications: number;
  old_login_audit_logs: number;
  old_import_jobs: number;
  old_restore_jobs: number;
  error?: string;
};

export type ParentCardPatternFixMode = "all_to_numbered" | "all_to_plain" | "h2_to_h1_only";

export type ParentCardPatternFixResult = {
  success: boolean;
  mode: ParentCardPatternFixMode;
  processed_count: number;
  merged_count: number;
  skipped_count: number;
  conflict_count: number;
  h2_fixed_count: number;
  parent_suffix_normalized_count: number;
  error?: string;
};

export type ImportIntegerDistributionFixResult = {
  success: boolean;
  processed_families: number;
  processed_members: number;
  updated_transactions: number;
  created_transactions: number;
  cancelled_transactions: number;
  error?: string;
};

export type InvalidSubunitAmountFixResult = {
  success: boolean;
  candidates_count: number;
  fixed_count: number;
  skipped_count: number;
  total_delta: number;
  error?: string;
};

export type SweepRequest = {
  dryRun?: boolean;
  mode?: DataHygieneMode;
  notificationRetentionDays?: number;
  auditRetentionDays?: number;
  jobsRetentionDays?: number;
};

export type BackgroundActor = {
  id: string;
  username: string;
  isAdmin: true;
};
