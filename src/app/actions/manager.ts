"use server";

import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import type { ManagerPermissions } from "@/lib/auth";

const DEFAULT_PERMISSIONS: ManagerPermissions = {
  import_beneficiaries: false,
  import_facilities: false,
  cancel_transactions: false,
  correct_transactions: false,
  delete_beneficiary: false,
  add_beneficiary: false,
  add_facility: false,
};

// ── إنشاء حساب مدير جديد (مشرف النظام فقط) ──────────────────────────────
export async function createManager(prevState: unknown, formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — مشرف النظام فقط" };
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

  const existing = await prisma.facility.findUnique({ where: { username } });
  if (existing) {
    return { error: "اسم المستخدم محجوز مسبقاً، اختر اسماً آخر" };
  }

  const tempPassword = "123456";
  const password_hash = await bcrypt.hash(tempPassword, 10);

  await prisma.facility.create({
    data: {
      name,
      username,
      password_hash,
      is_admin: false,
      is_manager: true,
      manager_permissions: DEFAULT_PERMISSIONS as unknown as Record<string, boolean>,
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

// ── تحديث صلاحيات مدير (مشرف النظام فقط) ───────────────────────────────
export async function updateManagerPermissions(
  managerId: string,
  permissions: ManagerPermissions
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — مشرف النظام فقط" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: { id: true, is_manager: true, deleted_at: true },
  });

  if (!manager || !manager.is_manager || manager.deleted_at) {
    return { error: "الحساب غير موجود أو ليس حساب مدير" };
  }

  // التحقق من أن القيم منطقية فقط
  const safePermissions: ManagerPermissions = {
    import_beneficiaries: permissions.import_beneficiaries === true,
    import_facilities: permissions.import_facilities === true,
    cancel_transactions: permissions.cancel_transactions === true,
    correct_transactions: permissions.correct_transactions === true,
    delete_beneficiary: permissions.delete_beneficiary === true,
    add_beneficiary: permissions.add_beneficiary === true,
    add_facility: permissions.add_facility === true,
  };

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
  return { success: true };
}

// ── حذف حساب مدير (مشرف النظام فقط) ────────────────────────────────────
export async function deleteManager(
  managerId: string
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — مشرف النظام فقط" };
  }

  if (managerId === session.id) {
    return { error: "لا يمكن حذف الحساب الحالي" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: { id: true, is_manager: true, deleted_at: true, name: true },
  });

  if (!manager || !manager.is_manager || manager.deleted_at) {
    return { error: "الحساب غير موجود أو ليس حساب مدير" };
  }

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
