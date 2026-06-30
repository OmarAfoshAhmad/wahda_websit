import { normalizeManagerPermissionsForRole } from "./permission-catalog";

export type ManagerPermissions = {
  view_dashboard: boolean;
  view_transactions: boolean;
  import_beneficiaries: boolean;
  add_beneficiary: boolean;
  edit_beneficiary: boolean;
  delete_beneficiary: boolean;
  add_facility: boolean;
  edit_facility: boolean;
  delete_facility: boolean;
  cancel_transactions: boolean;
  correct_transactions: boolean;
  edit_transaction: boolean;
  manage_recycle_bin: boolean;
  export_data: boolean;
  print_cards: boolean;
  view_audit_log: boolean;
  view_reports: boolean;
  view_facilities: boolean;
  view_beneficiaries: boolean;
  view_dental_beneficiaries: boolean;
  deduct_balance: boolean;
  delete_transaction: boolean;
  cash_claim: boolean;
  manage_card_numbering: boolean;
  migrate_card_numbering: boolean;
  manage_users: boolean;
  manage_companies: boolean; // SEC-05 FIX: صلاحية إدارة شركات التأمين وسياساتها
  dental_services: boolean; // صلاحية خدمات الأسنان
  optics_services: boolean; // صلاحية خدمات البصريات
  view_optics_beneficiaries: boolean; // عرض مستفيدي البصريات
  physiotherapy_services: boolean; // صلاحية خدمات العلاج الطبيعي
  view_physiotherapy_beneficiaries: boolean; // عرض مستفيدي العلاج الطبيعي
  add_manual_transaction: boolean; // صلاحية إضافة حركات يدوية
  edit_any_facility_transaction: boolean; // تعديل حركات خارج المرفق
};

export type UserRole = "ADMIN" | "MANAGER" | "EMPLOYEE" | "FACILITY";

export interface Session {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  is_admin: boolean;
  is_manager: boolean;
  is_employee: boolean;
  manager_permissions: ManagerPermissions | null;
  must_change_password: boolean;
  facility_type?: "HOSPITAL" | "PHARMACY" | "DENTAL" | "OPTICS";
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
 * - المشرف (ADMIN) دائماً لديه جميع الصلاحيات.
 * - المدير (MANAGER) أو الموظف (EMPLOYEE) يملكان فقط الصلاحيات التي فُعِّلت لهما.
 * - المرفق العادي (FACILITY) يملك صلاحيات مقيدة جداً وفق سياسة الدور الرسمية.
 */
export function hasPermission(
  session: Session,
  permission: keyof ManagerPermissions
): boolean {
  if (!session) return false;
  if (session.is_admin || session.role === "ADMIN") return true;

  const effectiveRole: UserRole =
    session.is_manager ? "MANAGER" : session.is_employee ? "EMPLOYEE" : session.role;

  if (effectiveRole !== "MANAGER" && effectiveRole !== "EMPLOYEE" && effectiveRole !== "FACILITY") {
    return false;
  }

  const perms = normalizeManagerPermissionsForRole(effectiveRole, session.manager_permissions);
  return perms[permission] === true;
}
