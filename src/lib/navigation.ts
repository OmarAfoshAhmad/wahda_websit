import { 
  LayoutDashboard, 
  Users, 
  Building2, 
  ClipboardList, 
  DatabaseBackup, 
  TriangleAlert, 
  ListOrdered, 
  UserCog, 
  Banknote, 
  Home,
  Activity,
  Stethoscope,
  Archive
} from "lucide-react";
import type { ManagerPermissions } from "./permissions";

export const BASE_NAV = [
  { name: "الرئيسية", href: "/dashboard", icon: LayoutDashboard, perm: "view_dashboard" as keyof ManagerPermissions },
  { name: "الحركات", href: "/transactions", icon: Activity, perm: "view_transactions" as keyof ManagerPermissions },
];

export const MANAGER_NAV = [
  { name: "المستفيدون", href: "/beneficiaries", icon: Users, perm: "view_beneficiaries" as keyof ManagerPermissions },
  { name: "المرافق الصحية", href: "/admin/facilities", icon: Building2, perm: "view_facilities" as keyof ManagerPermissions },
  { name: "سجل المراقبة", href: "/admin/audit-log", icon: ClipboardList, perm: "view_audit_log" as keyof ManagerPermissions },
];

export const SUPER_ADMIN_NAV = [
  { name: "المديرون", href: "/admin/managers", icon: UserCog, perm: "manage_users" as keyof ManagerPermissions },
];

export const MAINTENANCE_NAV = [
  { name: "ترقيم البطاقات", href: "/admin/card-numbering", icon: ListOrdered, perms: ["manage_card_numbering", "migrate_card_numbering"] as Array<keyof ManagerPermissions> },
  { name: "النسخ الاحتياطي", href: "/admin/backup", icon: DatabaseBackup, perms: [] },
  { name: "إدارة المشاكل", href: "/admin/duplicates", icon: TriangleAlert, perms: [] },
  { name: "جدول الحقيقة", href: "/admin/truth-registry", icon: ClipboardList, perms: [] },
  { name: "البطاقات القديمة", href: "/admin/legacy-cards", icon: Archive, perms: [] },
];

/** تبويب "خدمات الأسنان" — يظهر في الشريط الرئيسي للمشرف والمدير */
export const DENTAL_NAV = { name: "خدمات الأسنان", href: "/admin/dental-services", icon: Stethoscope };

/** تبويب "خدمات البصريات" */
export const OPTICS_NAV = { name: "خدمات البصريات", href: "/admin/optics-services", icon: Stethoscope };

export const CASH_CLAIM_NAV = { name: "كاش", href: "/cash-claim", icon: Banknote };
export const EMPLOYEE_HOME_NAV = { name: "الرئيسية", href: "/cash-claim", icon: Home };
