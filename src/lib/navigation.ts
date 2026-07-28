import { 
  WalletCards,
  Building2, 
  ClipboardList, 
  DatabaseBackup, 
  TriangleAlert, 
  ListOrdered, 
  UserCog, 
  Home,
  Stethoscope,
  Archive,
  Shield
} from "lucide-react";
import type { ManagerPermissions } from "./permissions";

export const BASE_NAV = [
  { name: "المخصص", href: "/dashboard", icon: WalletCards, perm: undefined },
];

export const MANAGER_NAV = [
  { name: "المرافق الصحية", href: "/admin/facilities", icon: Building2, perm: "view_facilities" as keyof ManagerPermissions },
];

export const MAINTENANCE_NAV = [
  { name: "المديرون", href: "/admin/managers", icon: UserCog, perms: ["manage_users"] as Array<keyof ManagerPermissions> },
  { name: "سجل المراقبة", href: "/admin/audit-log", icon: ClipboardList, perms: ["view_audit_log"] as Array<keyof ManagerPermissions> },
  { name: "شركات التأمين", href: "/admin/companies", icon: Building2, perms: ["manage_companies"] as Array<keyof ManagerPermissions> },
  { name: "سياسات التأمين", href: "/admin/service-policies", icon: Shield, perms: ["manage_companies"] as Array<keyof ManagerPermissions> },
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

/** تبويب "خدمات العلاج الطبيعي" */
export const PHYSIOTHERAPY_NAV = { name: "خدمات العلاج الطبيعي", href: "/admin/physiotherapy-services", icon: Stethoscope };

export const EMPLOYEE_HOME_NAV = { name: "الرئيسية", href: "/cash-claim", icon: Home };
