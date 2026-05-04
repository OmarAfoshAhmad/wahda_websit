export type ManagerPermissions = {
  import_beneficiaries: boolean;
  add_beneficiary: boolean;
  edit_beneficiary: boolean;
  delete_beneficiary: boolean;
  add_facility: boolean;
  edit_facility: boolean;
  delete_facility: boolean;
  cancel_transactions: boolean;
  correct_transactions: boolean;
  manage_recycle_bin: boolean;
  export_data: boolean;
  print_cards: boolean;
  view_audit_log: boolean;
  view_reports: boolean;
  view_facilities: boolean;
  view_beneficiaries: boolean;
  deduct_balance: boolean;
  delete_transaction: boolean;
  cash_claim: boolean;
  manage_card_numbering: boolean;
  migrate_card_numbering: boolean;
  manage_users: boolean;
};

export interface Session {
  id: string;
  name: string;
  username: string;
  is_admin: boolean;
  is_manager: boolean;
  is_employee: boolean;
  manager_permissions: ManagerPermissions | null;
  must_change_password: boolean;
  facility_type?: "HOSPITAL" | "PHARMACY";
  expires?: Date;
}

/**
 * صحيح إذا كان المستخدم مشرفاً أو مديراً أو موظفاً (يحق له الوصول لصفحات الإدارة)
 */
export function canAccessAdmin(session: Session): boolean {
  return session.is_admin || session.is_manager || session.is_employee;
}

/**
 * صحيح إذا كان للمستخدم صلاحية تنفيذ عملية معينة.
 * - المشرف (is_admin) دائماً لديه جميع الصلاحيات.
 * - المدير (is_manager) أو الموظف (is_employee) يملكان فقط الصلاحيات التي فُعِّلت لهما.
 */
export function hasPermission(
  session: Session,
  permission: keyof ManagerPermissions
): boolean {
  if (!session) return false;
  if (session.is_admin === true) return true;
  
  if (session.is_manager || session.is_employee) {
    let perms = session.manager_permissions;
    if (!perms) return false;

    try {
      const permsObj = typeof perms === "string" ? JSON.parse(perms) : perms;
      const val = permsObj[permission];
      return !!val && (val === true || val === "true" || val === 1 || val === "1");
    } catch (e) {
      console.error("Error parsing permissions:", e);
      return false;
    }
  }
  return false;
}
