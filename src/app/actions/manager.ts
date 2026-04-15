"use server";

import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import type { ManagerPermissions } from "@/lib/auth";

function isManagementOrEmployeeAccount(account: {
  is_manager: boolean;
  is_admin: boolean;
  manager_permissions: unknown;
}) {
  return account.is_manager || account.is_admin || account.manager_permissions !== null;
}

const DEFAULT_PERMISSIONS: ManagerPermissions = {
  import_beneficiaries: false,
  add_beneficiary: false,
  edit_beneficiary: false,
  delete_beneficiary: false,
  add_facility: false,
  edit_facility: false,
  delete_facility: false,
  cancel_transactions: false,
  correct_transactions: false,
  manage_recycle_bin: false,
  export_data: false,
  print_cards: false,
  view_audit_log: false,
  view_reports: false,
  view_facilities: false,
  view_beneficiaries: true,
  deduct_balance: true,
  delete_transaction: false,
  cash_claim: false,
};

const EMPLOYEE_PERMISSIONS: ManagerPermissions = {
  import_beneficiaries: false,
  add_beneficiary: false,
  edit_beneficiary: false,
  delete_beneficiary: false,
  add_facility: false,
  edit_facility: false,
  delete_facility: false,
  cancel_transactions: false,
  correct_transactions: false,
  manage_recycle_bin: false,
  export_data: false,
  print_cards: false,
  view_audit_log: false,
  view_reports: false,
  view_facilities: true,
  view_beneficiaries: true,
  deduct_balance: false,
  delete_transaction: false,
  cash_claim: true,
};

// ── إنشاء حساب مدير جديد (المبرمج فقط) ──────────────────────────────
export async function createManager(prevState: unknown, formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — المبرمج فقط" };
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

  // دائماً ينشئ حساب مدير — حساب المبرمج واحد فقط (admin) منشأ تلقائياً
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

// ── تحديث صلاحيات مدير (المبرمج فقط) ───────────────────────────────
export async function updateManagerPermissions(
  managerId: string,
  permissions: ManagerPermissions
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — المبرمج فقط" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: { id: true, is_manager: true, is_admin: true, manager_permissions: true, deleted_at: true },
  });

  if (!manager || !isManagementOrEmployeeAccount(manager) || manager.deleted_at) {
    return { error: "الحساب غير موجود أو ليس حساب مدير" };
  }

  const safePermissions: ManagerPermissions = {
    import_beneficiaries: permissions.import_beneficiaries === true,
    add_beneficiary: permissions.add_beneficiary === true,
    edit_beneficiary: permissions.edit_beneficiary === true,
    delete_beneficiary: permissions.delete_beneficiary === true,
    add_facility: permissions.add_facility === true,
    edit_facility: permissions.edit_facility === true,
    delete_facility: permissions.delete_facility === true,
    cancel_transactions: permissions.cancel_transactions === true,
    correct_transactions: permissions.correct_transactions === true,
    manage_recycle_bin: permissions.manage_recycle_bin === true,
    export_data: permissions.export_data === true,
    print_cards: permissions.print_cards === true,
    view_audit_log: permissions.view_audit_log === true,
    view_reports: permissions.view_reports === true,
    view_facilities: permissions.view_facilities === true,
    view_beneficiaries: permissions.view_beneficiaries === true,
    deduct_balance: permissions.deduct_balance === true,
    delete_transaction: permissions.delete_transaction === true,
    cash_claim: permissions.cash_claim === true,
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

// ── حذف حساب مدير (المبرمج فقط) ────────────────────────────────────
export async function deleteManager(
  managerId: string
): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — المبرمج فقط" };
  }

  if (managerId === session.id) {
    return { error: "لا يمكن حذف الحساب الحالي" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      is_manager: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
      name: true,
      _count: { select: { transactions: true } },
    },
  });

  if (!manager || !isManagementOrEmployeeAccount(manager)) {
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
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — المبرمج فقط" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      is_manager: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
      name: true,
    },
  });

  if (!manager || !isManagementOrEmployeeAccount(manager)) {
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
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — المبرمج فقط" };
  }

  if (managerId === session.id) {
    return { error: "لا يمكن حذف الحساب الحالي" };
  }

  const manager = await prisma.facility.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      is_manager: true,
      is_admin: true,
      manager_permissions: true,
      deleted_at: true,
      name: true,
      _count: { select: { transactions: true } },
    },
  });

  if (!manager || !isManagementOrEmployeeAccount(manager)) {
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
  if (!session?.is_admin) {
    return { error: "غير مصرح بهذه العملية — المبرمج فقط" };
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
      is_manager: false,
      manager_permissions: EMPLOYEE_PERMISSIONS as unknown as Record<string, boolean>,
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
