import prisma from "@/lib/prisma";
import { getSession, type Session, type ManagerPermissions } from "@/lib/auth";

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

  // التحقق من أن المستخدم (مرفق أو مشرف) لم يُحذف ناعماً
  const facility = await prisma.facility.findFirst({
    where: { id: session.id, deleted_at: null },
    select: { id: true },
  });

  return facility ? session : null;
}

/**
 * صحيح إذا كان المستخدم مشرفاً أو مديراً (يحق له الوصول لصفحات الإدارة)
 */
export function canAccessAdmin(session: Session): boolean {
  return session.is_admin || session.is_manager;
}

/**
 * صحيح إذا كان للمستخدم صلاحية تنفيذ عملية معينة.
 * - المشرف (is_admin) دائماً لديه جميع الصلاحيات.
 * - المدير (is_manager) يملك فقط الصلاحيات التي فُعِّلت له.
 * - المرافق الصحية العادية لا تملك أي صلاحية إدارية.
 */
export function hasPermission(
  session: Session,
  permission: keyof ManagerPermissions
): boolean {
  if (session.is_admin) return true;
  if (!session.is_manager) return false;
  const perms = session.manager_permissions;
  return perms?.[permission] === true;
}
