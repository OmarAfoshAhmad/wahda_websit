import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { type Session, type ManagerPermissions, hasPermission, canAccessAdmin } from "./permissions";

/**
 * يسترجع الجلسة الحالية ويتحقق من أن المرفق لم يُحذف ناعماً.
 * يُستخدم في Server Actions التي تُجري عمليات كتابة حساسة (خصم، استيراد...).
 *
 * - إذا لم توجد جلسة → returns null
 * - إذا كان المستخدم مشرفاً → يعود بالجلسة مباشرةً (لا حاجة لفحص DB)
 * - إذا كان المرفق محذوفاً ناعماً → returns null (يُعامَل كـ Unauthorized)
 */
export async function requireActiveFacilitySession(): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;

  // المشرف لا يحتاج لفحص DB — لديه جميع الصلاحيات تلقائياً
  if (session.is_admin) {
    return session;
  }

  // المدير والموظف: نجلب الصلاحيات الفعلية من DB لضمان تحديثها فوراً
  // (الـ JWT قد يحمل صلاحيات قديمة إذا عُدّلت بعد تسجيل الدخول)
  if (session.is_manager || session.is_employee) {
    const dbRecord = await prisma.facility.findFirst({
      where: { id: session.id, deleted_at: null },
      select: { manager_permissions: true },
    });

    if (!dbRecord) return null; // الحساب محذوف

    // تحديث الصلاحيات في الجلسة من قاعدة البيانات
    session.manager_permissions = (dbRecord.manager_permissions as ManagerPermissions) ?? null;
    return session;
  }

  // التحقق من أن المرفق لم يُحذف ناعماً
  const facility = await prisma.facility.findFirst({
    where: { id: session.id, deleted_at: null },
    select: { id: true },
  });

  return facility ? session : null;
}

/**
 * يسترجع الجلسة مع تحديث الصلاحيات من DB للمديرين والموظفين.
 * يُستخدم في صفحات Server Components التي تحتاج صلاحيات محدثة.
 * أخف من requireActiveFacilitySession — لا يفحص حذف المرفق الناعم.
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
      manager_permissions: true,
      name: true,
      deleted_at: true
    },
  });

  if (!dbRecord || dbRecord.deleted_at !== null) {
    return null;
  }

  let perms = dbRecord.manager_permissions;
  
  return {
    ...session,
    id: session.id,
    is_admin: dbRecord.is_admin,
    is_manager: dbRecord.is_manager,
    is_employee: dbRecord.is_employee,
    name: dbRecord.name,
    manager_permissions: perms as any as ManagerPermissions || null,
  };
}

// يتم تصدير canAccessAdmin و hasPermission الآن من permissions.ts لضمان إمكانية استخدامهما في المكونات الأمامية
export { canAccessAdmin, hasPermission };
export type { Session, ManagerPermissions };
