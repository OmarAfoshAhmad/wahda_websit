import type { ManagerPermissions, UserRole } from "./permissions";

export type PermissionKey = keyof ManagerPermissions;
export type PermissionPolicyRole = UserRole | "FACILITY";
export type ManagedPermissionRole = Exclude<PermissionPolicyRole, "ADMIN">;
export type PermissionGroupId =
  | "beneficiaries"
  | "facilities"
  | "transactions"
  | "reports"
  | "operations"
  | "admin"
  | "companies"
  | "dental"
  | "optics";

type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  group: PermissionGroupId;
};

export const PERMISSION_DEFINITIONS: ReadonlyArray<PermissionDefinition> = [
  { key: "view_dashboard", label: "عرض الصفحة الرئيسية", group: "reports" },
  { key: "view_transactions", label: "عرض صفحة الحركات", group: "transactions" },
  { key: "import_beneficiaries", label: "استيراد مستفيدين", group: "beneficiaries" },
  { key: "add_beneficiary", label: "إضافة مستفيد جديد", group: "beneficiaries" },
  { key: "edit_beneficiary", label: "تعديل بيانات المستفيدين", group: "beneficiaries" },
  { key: "delete_beneficiary", label: "حذف المستفيدين (نهائياً أو مؤقتاً)", group: "beneficiaries" },
  { key: "manage_recycle_bin", label: "إدارة سلة المحذوفات", group: "beneficiaries" },

  { key: "view_facilities", label: "عرض المرافق الصحية", group: "facilities" },
  { key: "add_facility", label: "إضافة مرفق جديد", group: "facilities" },
  { key: "edit_facility", label: "تعديل بيانات المرافق", group: "facilities" },
  { key: "delete_facility", label: "حذف المرافق من النظام", group: "facilities" },

  { key: "deduct_balance", label: "إمكانية خصم الرصيد (نقطة بيع)", group: "transactions" },
  { key: "cancel_transactions", label: "إلغاء الحركات المالية", group: "transactions" },
  { key: "correct_transactions", label: "إعادة خصم الرصيد / تصحيح حركات", group: "transactions" },
  { key: "edit_transaction", label: "تعديل الحركات المالية", group: "transactions" },
  { key: "delete_transaction", label: "حذف الحركات المالية (نهائياً أو مؤقتاً)", group: "transactions" },
  { key: "add_manual_transaction", label: "إضافة حركات يدوية", group: "transactions" },
  { key: "edit_any_facility_transaction", label: "تعديل الحركات لأي مرفق", group: "transactions" },

  { key: "view_beneficiaries", label: "عرض قائمة المستفيدين", group: "reports" },
  { key: "view_dental_beneficiaries", label: "عرض مستفيدي خدمات الأسنان", group: "dental" },
  { key: "view_reports", label: "عرض التقارير الإحصائية (المفصلة)", group: "reports" },
  { key: "view_audit_log", label: "عرض سجل المراقبة (Audit Log)", group: "reports" },
  { key: "export_data", label: "تصدير التقارير والبيانات (Excel/PDF)", group: "reports" },

  { key: "print_cards", label: "طباعة الكروت والبطاقات", group: "operations" },
  { key: "manage_card_numbering", label: "إدارة ترقيم البطاقات (استيراد ومعاينة)", group: "operations" },
  { key: "migrate_card_numbering", label: "ترحيل أرقام البطاقات (تنفيذ نهائي)", group: "operations" },
  { key: "cash_claim", label: "إمكانية الكاش العائلي", group: "operations" },

  { key: "manage_users", label: "إدارة الحسابات (إنشاء، تعديل، حذف، صلاحيات)", group: "admin" },
  { key: "manage_companies", label: "إدارة شركات التأمين والسياسات", group: "companies" },
  { key: "dental_services", label: "صلاحية خدمات الأسنان (خصم، حركات، كشف)", group: "dental" },
  { key: "optics_services", label: "صلاحية خدمات البصريات (خصم، حركات، كشف)", group: "optics" },
  { key: "view_optics_beneficiaries", label: "عرض مستفيدي خدمات البصريات", group: "optics" },
];

export const PERMISSION_KEYS = PERMISSION_DEFINITIONS.map((d) => d.key);

export const PERMISSION_LABELS: Record<PermissionKey, string> = PERMISSION_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.key] = def.label;
    return acc;
  },
  {} as Record<PermissionKey, string>,
);

const PERMISSION_GROUP_LABELS: Record<PermissionGroupId, string> = {
  beneficiaries: "المستفيدون",
  facilities: "المرافق",
  transactions: "الحركات",
  reports: "التقارير",
  operations: "التشغيل",
  admin: "إدارة المستخدمين",
  companies: "شركات التأمين",
  dental: "خدمات الأسنان",
  optics: "خدمات البصريات",
};

export const PERMISSION_GROUPS = Object.entries(
  PERMISSION_GROUP_LABELS,
).map(([groupId, groupLabel]) => ({
  groupId: groupId as PermissionGroupId,
  groupLabel,
  keys: PERMISSION_DEFINITIONS.filter((d) => d.group === groupId).map((d) => d.key),
}));

function toBooleanPermissionValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function buildPermissionsFromEnabledKeys(enabled: ReadonlyArray<PermissionKey>): ManagerPermissions {
  const enabledSet = new Set<PermissionKey>(enabled);
  const result = {} as ManagerPermissions;
  for (const key of PERMISSION_KEYS) {
    result[key] = enabledSet.has(key);
  }
  return result;
}

const EMPLOYEE_ALLOWED_PERMISSION_KEYS = [
  "view_dashboard",
  "view_transactions",
  "view_beneficiaries",
  "view_dental_beneficiaries",
  "view_facilities",
  "cash_claim",
  "dental_services",
  "optics_services",
  "view_optics_beneficiaries",
] as const satisfies ReadonlyArray<PermissionKey>;

const FACILITY_ALLOWED_PERMISSION_KEYS = [
  "view_dashboard",
  "view_transactions",
  "view_beneficiaries",
  "view_dental_beneficiaries",
  "deduct_balance",
  "dental_services",
  "optics_services",
  "view_optics_beneficiaries",
] as const satisfies ReadonlyArray<PermissionKey>;

const ROLE_ALLOWED_PERMISSION_KEYS: Record<PermissionPolicyRole, ReadonlyArray<PermissionKey>> = {
  ADMIN: PERMISSION_KEYS,
  MANAGER: PERMISSION_KEYS,
  EMPLOYEE: PERMISSION_KEYS,
  FACILITY: PERMISSION_KEYS,
};

const ROLE_DEFAULT_ENABLED_PERMISSION_KEYS: Record<
  PermissionPolicyRole,
  ReadonlyArray<PermissionKey>
> = {
  ADMIN: PERMISSION_KEYS,
  MANAGER: [
    "view_dashboard",
    "view_transactions",
    "view_beneficiaries",
    "view_dental_beneficiaries",
    "view_optics_beneficiaries",
    "deduct_balance",
    "dental_services",
    "optics_services",
  ],
  EMPLOYEE: [
    "view_dashboard",
    "view_transactions",
    "view_beneficiaries",
    "view_dental_beneficiaries",
    "view_optics_beneficiaries",
    "view_facilities",
    "cash_claim",
    "dental_services",
    "optics_services",
  ],
  FACILITY: [
    "view_dashboard",
    "view_transactions",
    "deduct_balance",
    "dental_services",
    "optics_services",
  ],
};

export const ROLE_LABELS: Record<PermissionPolicyRole, string> = {
  ADMIN: "مبرمج",
  MANAGER: "مدير",
  EMPLOYEE: "موظف",
  FACILITY: "مرفق",
};

export function getEmptyPermissions(): ManagerPermissions {
  return buildPermissionsFromEnabledKeys([]);
}

export function getAllPermissionsEnabled(): ManagerPermissions {
  return buildPermissionsFromEnabledKeys(PERMISSION_KEYS);
}

function getRoleAsPolicyRole(role: PermissionPolicyRole): PermissionPolicyRole {
  if (role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE" || role === "FACILITY") {
    return role;
  }
  return "FACILITY";
}

export function getAllowedPermissionKeysForRole(
  role: PermissionPolicyRole,
): ReadonlyArray<PermissionKey> {
  return ROLE_ALLOWED_PERMISSION_KEYS[getRoleAsPolicyRole(role)];
}

export function getLockedPermissionKeysForRole(
  role: PermissionPolicyRole,
): ReadonlyArray<PermissionKey> {
  const allowed = new Set(getAllowedPermissionKeysForRole(role));
  return PERMISSION_KEYS.filter((key) => !allowed.has(key));
}

export function isPermissionAllowedForRole(
  role: PermissionPolicyRole,
  permission: PermissionKey,
): boolean {
  return getAllowedPermissionKeysForRole(role).includes(permission);
}

export function getDefaultPermissionsForRole(role: PermissionPolicyRole): ManagerPermissions {
  return buildPermissionsFromEnabledKeys(ROLE_DEFAULT_ENABLED_PERMISSION_KEYS[getRoleAsPolicyRole(role)]);
}

export function normalizeManagerPermissions(
  value: unknown,
  fallback?: Partial<ManagerPermissions>,
): ManagerPermissions {
  let raw = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }

  const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = {} as ManagerPermissions;

  for (const key of PERMISSION_KEYS) {
    const base = fallback?.[key];
    const incoming = rawObj[key];
    result[key] = toBooleanPermissionValue(incoming ?? base ?? false);
  }

  return result;
}

export function normalizeManagerPermissionsForRole(
  role: PermissionPolicyRole,
  value: unknown,
  fallback?: Partial<ManagerPermissions>,
): ManagerPermissions {
  const policyRole = getRoleAsPolicyRole(role);
  const normalized = normalizeManagerPermissions(
    value,
    fallback ?? getDefaultPermissionsForRole(policyRole),
  );

  if (policyRole === "ADMIN") {
    return getAllPermissionsEnabled();
  }

  const allowedSet = new Set(getAllowedPermissionKeysForRole(policyRole));
  const result = {} as ManagerPermissions;
  for (const key of PERMISSION_KEYS) {
    result[key] = allowedSet.has(key) ? normalized[key] : false;
  }
  return result;
}

export function resolvePermissionRole(account: {
  role?: string | null;
  is_admin?: boolean | null;
  is_manager?: boolean | null;
  is_employee?: boolean | null;
}): PermissionPolicyRole {
  if (account.role === "ADMIN" || account.is_admin) return "ADMIN";
  if (account.role === "MANAGER" || account.is_manager) return "MANAGER";
  if (account.role === "EMPLOYEE" || account.is_employee) return "EMPLOYEE";
  if (account.role === "FACILITY") return "FACILITY";
  return "FACILITY";
}

export type PermissionPresetId =
  | "none"
  | "facility_basic"
  | "manager_basic"
  | "employee_cash"
  | "full_access";

export const PERMISSION_PRESETS: ReadonlyArray<{
  id: PermissionPresetId;
  label: string;
  description: string;
}> = [
  { id: "manager_basic", label: "مدير افتراضي", description: "عرض المستفيدين + خصم الرصيد" },
  { id: "employee_cash", label: "موظف كاش", description: "كاش عائلي + عرض المستفيدين والمرافق" },
  { id: "facility_basic", label: "مرفق افتراضي", description: "إعداد افتراضي للمرفق" },
  { id: "full_access", label: "كل الصلاحيات", description: "منح جميع الصلاحيات" },
  { id: "none", label: "إلغاء الكل", description: "إيقاف جميع الصلاحيات" },
];

const PRESET_IDS_BY_ROLE: Record<PermissionPolicyRole, ReadonlyArray<PermissionPresetId>> = {
  ADMIN: ["full_access", "none"],
  MANAGER: ["manager_basic", "full_access", "none"],
  EMPLOYEE: ["employee_cash", "full_access", "none"],
  FACILITY: ["facility_basic", "full_access", "none"],
};

export function getPermissionPresetsForRole(
  role: PermissionPolicyRole,
): ReadonlyArray<(typeof PERMISSION_PRESETS)[number]> {
  const ids = new Set(PRESET_IDS_BY_ROLE[getRoleAsPolicyRole(role)]);
  return PERMISSION_PRESETS.filter((preset) => ids.has(preset.id));
}

export function getPermissionPreset(
  presetId: PermissionPresetId,
  role?: PermissionPolicyRole,
): ManagerPermissions {
  const rawPreset =
    presetId === "full_access"
      ? getAllPermissionsEnabled()
      : presetId === "manager_basic"
        ? getDefaultPermissionsForRole("MANAGER")
        : presetId === "employee_cash"
          ? getDefaultPermissionsForRole("EMPLOYEE")
          : presetId === "facility_basic"
            ? getDefaultPermissionsForRole("FACILITY")
            : getEmptyPermissions();

  if (!role) return rawPreset;
  return normalizeManagerPermissionsForRole(role, rawPreset, getDefaultPermissionsForRole(role));
}
