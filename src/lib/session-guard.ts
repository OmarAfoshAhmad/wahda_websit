import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { type Session, type ManagerPermissions, type UserRole, hasPermission, canAccessAdmin } from "./permissions";
import { normalizeManagerPermissionsForRole } from "./permission-catalog";

/**
 * يسترجع الجلسة الحالية ويتحقق من أن المرفق لم يُحذف ناعماً.
 * يُستخدم في Server Actions التي تُجري عمليات كتابة حساسة (خصم، استيراد...).
 *
 * - إذا لم توجد جلسة → returns null
 * - يضمن جلب الصلاحيات والدور ونوع المرفق حياً من قاعدة البيانات لضمان المزامنة الفورية.
 */
export async function requireActiveFacilitySession(): Promise<Session | null> {
  const session = await getSession();
  if (!session || !session.id) return null;

  const dbRecord = await prisma.facility.findFirst({
    where: { id: session.id, deleted_at: null },
    select: { 
      is_admin: true,
      is_manager: true, 
      is_employee: true, 
      role: true,
      facility_type: true,
      manager_permissions: true,
      name: true
    },
  });

  if (!dbRecord) return null;

  const role = dbRecord.role as UserRole;
  const facilityType = dbRecord.facility_type as Session["facility_type"] | null;
  // توحيد الأعلام مع الدور لتجاوز أي عدم اتساق قديم في الحقول المنطقية.
  const isAdmin = dbRecord.is_admin || role === "ADMIN";
  const isManager = dbRecord.is_manager || role === "MANAGER";
  const isEmployee = dbRecord.is_employee || role === "EMPLOYEE";
  const managerPermissions = normalizeManagerPermissionsForRole(role, dbRecord.manager_permissions);

  return {
    ...session,
    id: session.id,
    name: dbRecord.name,
    role,
    is_admin: isAdmin,
    is_manager: isManager,
    is_employee: isEmployee,
    facility_type: facilityType ?? undefined,
    manager_permissions: managerPermissions,
  };
}

/**
 * يسترجع الجلسة مع تحديث الصلاحيات والأدوار ونوع المرفق حياً من قاعدة البيانات.
 * يُستخدم في صفحات Server Components التي تحتاج صلاحيات محدثة فوراً.
 */
export async function getSessionWithFreshPermissions(): Promise<Session | null> {
  const session = await getSession();
  if (!session || !session.id) return null;

  const dbRecord = await prisma.facility.findUnique({
    where: { id: session.id },
    select: { 
      is_admin: true,
      is_manager: true, 
      is_employee: true, 
      role: true,
      facility_type: true,
      manager_permissions: true,
      name: true,
      deleted_at: true
    },
  });

  if (!dbRecord || dbRecord.deleted_at !== null) {
    return null;
  }

  const role = dbRecord.role as UserRole;
  const facilityType = dbRecord.facility_type as Session["facility_type"] | null;
  // توحيد الأعلام مع الدور لتجاوز أي عدم اتساق قديم في الحقول المنطقية.
  const isAdmin = dbRecord.is_admin || role === "ADMIN";
  const isManager = dbRecord.is_manager || role === "MANAGER";
  const isEmployee = dbRecord.is_employee || role === "EMPLOYEE";
  const managerPermissions = normalizeManagerPermissionsForRole(role, dbRecord.manager_permissions);

  return {
    ...session,
    id: session.id,
    name: dbRecord.name,
    role,
    is_admin: isAdmin,
    is_manager: isManager,
    is_employee: isEmployee,
    facility_type: facilityType ?? undefined,
    manager_permissions: managerPermissions,
  };
}

// يتم تصدير canAccessAdmin و hasPermission لضمان إمكانية استخدامهما في المكونات الأمامية
export { canAccessAdmin, hasPermission };
export type { Session, ManagerPermissions };
