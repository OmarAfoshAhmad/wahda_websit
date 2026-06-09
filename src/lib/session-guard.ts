import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { type Session, type ManagerPermissions, type UserRole, hasPermission, canAccessAdmin } from "./permissions";
import { normalizeManagerPermissionsForRole, resolvePermissionRole } from "./permission-catalog";

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
      must_change_password: true,
      name: true
    },
  });

  if (!dbRecord) return null;

  if (dbRecord.must_change_password) {
    redirect("/change-password");
  }

  const role = resolvePermissionRole({
    role: dbRecord.role,
    is_admin: dbRecord.is_admin,
    is_manager: dbRecord.is_manager,
    is_employee: dbRecord.is_employee,
  }) as UserRole;
  const facilityType = dbRecord.facility_type as Session["facility_type"] | null;
  // توحيد الأعلام اعتماداً على الدور المحسوب (يعالج حالات role غير المتسق بعد الاستعادة/الرفع).
  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER";
  const isEmployee = role === "EMPLOYEE";
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
  let dbRecord: any = null;
  let session = await getSession();

  try {
    if (!session || !session.id) return null;

    dbRecord = await prisma.facility.findUnique({
      where: { id: session.id },
      select: { 
        is_admin: true,
        is_manager: true, 
        is_employee: true, 
        role: true,
        facility_type: true,
        manager_permissions: true,
        must_change_password: true,
        name: true,
        deleted_at: true
      },
    });
  } catch (error) {
    console.error("SESSION_GUARD_ERROR", error);
    return null;
  }

  if (!dbRecord || dbRecord.deleted_at !== null) {
    return null;
  }

  if (dbRecord.must_change_password) {
    redirect("/change-password");
  }

  const role = resolvePermissionRole({
    role: dbRecord.role,
    is_admin: dbRecord.is_admin,
    is_manager: dbRecord.is_manager,
    is_employee: dbRecord.is_employee,
  }) as UserRole;
  const facilityType = dbRecord.facility_type as Session["facility_type"] | null;
  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER";
  const isEmployee = role === "EMPLOYEE";
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
