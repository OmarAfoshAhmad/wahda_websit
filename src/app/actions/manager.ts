"use server";

import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import type { ManagerPermissions } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permission-catalog";
import {
  getDefaultPermissionsForRole,
  normalizeManagerPermissionsForRole,
  PERMISSION_KEYS,
  resolvePermissionRole,
} from "@/lib/permission-catalog";

function isPermissionsManagedAccount(account: {
  role: string;
  is_manager: boolean;
  is_admin: boolean;
  is_employee: boolean;
  manager_permissions: unknown;
}) {
  // يمنع العبث بصلاحيات حسابات ADMIN بشكل صريح
  if (account.is_admin || account.role === "ADMIN") return false;

  // يسمح بإدارة الصلاحيات لحسابات: MANAGER / EMPLOYEE / FACILITY
  return (
    account.role === "MANAGER" ||
    account.role === "EMPLOYEE" ||
    account.role === "FACILITY" ||
    account.is_manager === true ||
    account.is_employee === true
  );
}

// ── إنشاء حساب مدير جديد (المبرمج فقط) ──────────────────────────────
export async function createManager(prevState: unknown, formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const name = formData.get("name")?.toString().trim() ?? "";
  const username = formData
    .get("username")
    ?.toString()
    .trim()
    .toLowerCase() ?? "";

  if (!name || name.length < 2 || name.length > 80) {
    return { error: "الاسم يجب أن يكون بين 2 و80 حرفاً" };
  }
  if (!username || !/^[a-z0-9_]+$/.test(username) || username.length > 40) {
    return { error: "اسم المستخدم: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط" };
  }

  const existing = await prisma.facility.findUnique({
    where: { username },
    select: { deleted_at: true },
  });
  if (existing) {
    if (existing.deleted_at) {
      return { error: "اسم المستخدم مرتبط بحساب موجود في المحذوفات. يمكنك استرجاعه من تبويب المحذوفات أو اختيار اسم آخر." };
    }
    return { error: "اسم المستخدم مستخدم فعلياً. اختر اسماً آخر." };
  }

  const tempPassword = "123456";
  const password_hash = await bcrypt.hash(tempPassword, 10);

  // دائماً ينشئ حساب مدير — حساب المبرمج واحد فقط (admin) منشأ تلقائياً
  await prisma.facility.create({
    data: {
      name,
      username,
      password_hash,
      is_admin: false,
      is_manager: true,
      role: "MANAGER",
      manager_permissions: getDefaultPermissionsForRole("MANAGER") as unknown as Record<string, boolean>,
      must_change_password: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "CREATE_MANAGER",
      metadata: { manager_username: username, name },
    },
  });

  revalidatePath("/admin/managers");
  return { success: true, tempPassword };
}

// ── إعادة تعيين كلمة مرور المدير (المبرمج والمدراء الذين لديهم صلاحية) ──────────────────────────────
export async function resetManagerPassword(managerId: string): Promise<{ error?: string; success?: boolean; tempPassword?: string }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const target = await prisma.facility.findUnique({
    where: { id: managerId },
    select: { id: true, is_admin: true, username: true, role: true },
  });

  if (!target) {
    return { error: "الحساب غير موجود" };
  }

  if (target.is_admin || target.role === "ADMIN") {
    return { error: "لا يمكن إعادة تعيين كلمة مرور المبرمج الرئيسي" };
  }

  const tempPassword = "123456";
  const password_hash = await bcrypt.hash(tempPassword, 10);

  await prisma.facility.update({
    where: { id: managerId },
    data: { password_hash, must_change_password: true },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "RESET_MANAGER_PASSWORD",
      metadata: { target_username: target.username },
    },
  });

  revalidatePath("/admin/managers");
  return { success: true, tempPassword };
}

// ── تحديث صلاحيات مدير (المبرمج فقط) ───────────────────────────────
export async function updateManagerPermissions(
  managerId: string,
  permissions: ManagerPermissions
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      role: true,
      is_manager: true,
      is_employee: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
    },
  });

  if (!manager || !isPermissionsManagedAccount(manager) || manager.deleted_at) {
    return { error: "الحساب غير موجود أو غير قابل لإدارة الصلاحيات" };
  }

  const targetRole = resolvePermissionRole(manager);
  const safePermissions: ManagerPermissions = normalizeManagerPermissionsForRole(
    targetRole,
    permissions,
    getDefaultPermissionsForRole(targetRole),
  );

  await prisma.facility.update({
    where: { id: managerId },
    data: { manager_permissions: safePermissions as unknown as Record<string, boolean> },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "UPDATE_MANAGER_PERMISSIONS",
      metadata: { manager_id: managerId, permissions: safePermissions },
    },
  });

  revalidatePath("/admin/managers");
  revalidatePath("/admin/facilities");
  return { success: true };
}

export async function updateManagersPermissionBulk(
  managerIds: string[],
  permission: PermissionKey,
  enabled: boolean,
): Promise<{ error?: string; success?: boolean; updatedCount?: number }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const uniqueIds = Array.from(new Set(managerIds.map(String))).filter(Boolean);
  if (uniqueIds.length === 0) return { error: "حدد حساباً واحداً على الأقل" };
  if (uniqueIds.length > 200) return { error: "الحد الأقصى للعملية الجماعية 200 حساب" };
  if (!PERMISSION_KEYS.includes(permission)) return { error: "الصلاحية المحددة غير صحيحة" };

  const accounts = await prisma.facility.findMany({
    where: { id: { in: uniqueIds }, deleted_at: null },
    select: {
      id: true,
      role: true,
      role_v2: true,
      is_manager: true,
      is_employee: true,
      is_admin: true,
      manager_permissions: true,
    },
  });
  const manageable = accounts.filter(isPermissionsManagedAccount);
  if (manageable.length === 0) return { error: "لا توجد حسابات قابلة لتعديل الصلاحيات ضمن المحدد" };

  await prisma.$transaction(async (tx) => {
    for (const account of manageable) {
      const role = resolvePermissionRole(account);
      const current = normalizeManagerPermissionsForRole(role, account.manager_permissions);
      const next = normalizeManagerPermissionsForRole(role, { ...current, [permission]: enabled });
      await tx.facility.update({
        where: { id: account.id },
        data: { manager_permissions: next as unknown as Record<string, boolean> },
      });
    }
    await tx.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "BULK_UPDATE_MANAGER_PERMISSION",
        metadata: {
          account_ids: manageable.map((account) => account.id),
          permission,
          enabled,
          updated_count: manageable.length,
        },
      },
    });
  });

  revalidatePath("/admin/managers");
  revalidatePath("/admin/facilities");
  return { success: true, updatedCount: manageable.length };
}

// ── تعديل اسم حساب إدارة/موظف ───────────────────────────────────────
export async function updateManagerName(
  managerId: string,
  nextName: string,
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const name = String(nextName ?? "").trim();
  if (!name || name.length < 2 || name.length > 80) {
    return { error: "الاسم يجب أن يكون بين 2 و80 حرفاً" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      role: true,
      is_manager: true,
      is_employee: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
      name: true,
    },
  });

  if (!manager || !isPermissionsManagedAccount(manager) || manager.deleted_at) {
    return { error: "الحساب غير موجود أو غير قابل للتعديل" };
  }

  await prisma.facility.update({
    where: { id: managerId },
    data: { name },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "UPDATE_MANAGER_NAME",
      metadata: { manager_id: managerId, old_name: manager.name, new_name: name },
    },
  });

  revalidatePath("/admin/managers");
  revalidatePath("/admin/facilities");
  return { success: true };
}

// ── حذف حساب مدير (المبرمج فقط) ────────────────────────────────────
export async function deleteManager(
  managerId: string
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  if (managerId === session.id) {
    return { error: "لا يمكن حذف الحساب الحالي" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      role: true,
      is_manager: true,
      is_employee: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
      name: true,
      _count: { select: { transactions: true } },
    },
  });

  if (!manager || !isPermissionsManagedAccount(manager)) {
    return { error: "الحساب غير موجود أو ليس حساب إدارة" };
  }

  if (manager.deleted_at) {
    return { error: "الحساب محذوف ناعما بالفعل" };
  }

  // حسب السياسة الجديدة: الحذف من شاشة الإدارة = حذف ناعم فقط
  await prisma.facility.update({
    where: { id: managerId },
    data: { deleted_at: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "DELETE_MANAGER",
      metadata: { manager_id: managerId, name: manager.name },
    },
  });

  revalidatePath("/admin/managers");
  return { success: true };
}

export async function restoreManager(
  managerId: string
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      role: true,
      is_manager: true,
      is_employee: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
      name: true,
    },
  });

  if (!manager || !isPermissionsManagedAccount(manager)) {
    return { error: "الحساب غير موجود أو ليس حساب إدارة/موظف" };
  }
  if (!manager.deleted_at) {
    return { error: "الحساب غير محذوف" };
  }

  await prisma.facility.update({
    where: { id: managerId },
    data: { deleted_at: null },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "RESTORE_MANAGER",
      metadata: { manager_id: managerId, name: manager.name },
    },
  });

  revalidatePath("/admin/managers");
  return { success: true };
}

export async function permanentlyDeleteManager(
  managerId: string
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  if (managerId === session.id) {
    return { error: "لا يمكن حذف الحساب الحالي" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      role: true,
      is_manager: true,
      is_employee: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
      name: true,
      _count: { select: { transactions: true } },
    },
  });

  if (!manager || !isPermissionsManagedAccount(manager)) {
    return { error: "الحساب غير موجود أو ليس حساب إدارة/موظف" };
  }
  if (!manager.deleted_at) {
    return { error: "يجب تنفيذ الحذف الناعم أولا" };
  }
  if (manager._count.transactions > 0) {
    return { error: `لا يمكن الحذف النهائي — يوجد ${manager._count.transactions} معاملات مرتبطة` };
  }

  const deleted = await prisma.facility.deleteMany({ where: { id: managerId } });
  if (deleted.count === 0) {
    return { error: "تعذر تنفيذ الحذف النهائي" };
  }

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "PERMANENT_DELETE_MANAGER",
      metadata: { manager_id: managerId, name: manager.name },
    },
  });

  revalidatePath("/admin/managers");
  return { success: true };
}

// ── إنشاء حساب موظف جديد (المبرمج فقط) ──────────────────────────────
export async function createEmployee(prevState: unknown, formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_users")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const name = formData.get("name")?.toString().trim() ?? "";
  const username = formData
    .get("username")
    ?.toString()
    .trim()
    .toLowerCase() ?? "";

  if (!name || name.length < 2 || name.length > 80) {
    return { error: "الاسم يجب أن يكون بين 2 و80 حرفاً" };
  }
  if (!username || !/^[a-z0-9_]+$/.test(username) || username.length > 40) {
    return { error: "اسم المستخدم: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط" };
  }

  const existing = await prisma.facility.findUnique({
    where: { username },
    select: { deleted_at: true },
  });
  if (existing) {
    if (existing.deleted_at) {
      return { error: "اسم المستخدم مرتبط بحساب موجود في المحذوفات. يمكنك استرجاعه من تبويب المحذوفات أو اختيار اسم آخر." };
    }
    return { error: "اسم المستخدم مستخدم فعلياً. اختر اسماً آخر." };
  }

  const tempPassword = "123456";
  const password_hash = await bcrypt.hash(tempPassword, 10);

  await prisma.facility.create({
    data: {
      name,
      username,
      password_hash,
      is_admin: false,
      is_manager: false,
      is_employee: true,
      role: "EMPLOYEE",
      manager_permissions: getDefaultPermissionsForRole("EMPLOYEE") as unknown as Record<string, boolean>,
      must_change_password: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "CREATE_EMPLOYEE",
      metadata: { employee_username: username, name },
    },
  });

  revalidatePath("/admin/managers");
  return { success: true, tempPassword };
}
