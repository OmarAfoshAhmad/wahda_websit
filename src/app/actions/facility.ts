"use server";

import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { createFacilitySchema, updateFacilitySchema } from "@/lib/validation";
import { inferFacilityTypeFromText, normalizeFacilityTypeOverride } from "@/lib/facility-type";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";

export async function createFacility(prevState: unknown, formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, 'add_facility')) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  const data = Object.fromEntries(formData);
  const validated = createFacilitySchema.safeParse(data);

  if (!validated.success) {
    const firstError = Object.values(validated.error.flatten().fieldErrors)[0]?.[0];
    return { error: firstError ?? "بيانات غير صالحة" };
  }

  const { name, username, facility_type } = validated.data;

  const existing = await prisma.facility.findUnique({ where: { username } });
  if (existing) {
    return { error: "اسم المستخدم محجوز مسبقاً، اختر اسماً آخر" };
  }

  const tempPassword = "123456";
  const password_hash = await bcrypt.hash(tempPassword, 10);

  const createdFacility = await prisma.facility.create({
    data: { name, username, password_hash, is_admin: false, must_change_password: true },
    select: { id: true },
  });

  const inferredFacilityType = inferFacilityTypeFromText(name, username);
  const normalizedOverride =
    facility_type === "AUTO"
      ? null
      : normalizeFacilityTypeOverride(facility_type);

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "CREATE_FACILITY",
      metadata: {
        facility_id: createdFacility.id,
        new_facility_username: username,
        name,
        facility_type_inferred: inferredFacilityType,
        facility_type_override: normalizedOverride,
        facility_type_effective: normalizedOverride ?? inferredFacilityType,
      },
    },
  });

  revalidatePath("/admin/facilities");
  return {
    success: true,
    createdName: name,
    tempPassword,
  };
}

export async function updateFacility(data: {
  id: string;
  name: string;
  username: string;
  facility_type?: "AUTO" | "HOSPITAL" | "PHARMACY";
  resetPassword?: boolean;
}) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "edit_facility")) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  const parsed = updateFacilitySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { id, name, username, facility_type } = parsed.data;

  // التحقق من وجود المرفق
  const facility = await prisma.facility.findUnique({ where: { id } });
  if (!facility) {
    return { error: "المرفق غير موجود" };
  }

  // التحقق من عدم تكرار اسم المستخدم
  const existing = await prisma.facility.findUnique({ where: { username } });
  if (existing && existing.id !== id) {
    return { error: "اسم المستخدم محجوز مسبقاً، اختر اسماً آخر" };
  }

  const updateData: Record<string, unknown> = { name, username };
  const inferredFacilityType = inferFacilityTypeFromText(name, username);
  const normalizedOverride =
    facility_type === "AUTO"
      ? null
      : normalizeFacilityTypeOverride(facility_type);

  if (data.resetPassword) {
    const tempPassword = "123456";
    updateData.password_hash = await bcrypt.hash(tempPassword, 10);
    updateData.must_change_password = true;

    await prisma.facility.update({ where: { id }, data: updateData });
    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "UPDATE_FACILITY",
        metadata: {
          facility_id: id,
          name,
          username,
          reset_password: true,
          facility_type_inferred: inferredFacilityType,
          facility_type_override: normalizedOverride,
          facility_type_effective: normalizedOverride ?? inferredFacilityType,
        },
      },
    });
    revalidatePath("/admin/facilities");
    // يُعاد في الاستجابة ليُعرض للمشرف مرة واحدة فقط
    return { success: true, tempPassword };
  }

  await prisma.facility.update({ where: { id }, data: updateData });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "UPDATE_FACILITY",
      metadata: {
        facility_id: id,
        name,
        username,
        reset_password: data.resetPassword ?? false,
        facility_type_inferred: inferredFacilityType,
        facility_type_override: normalizedOverride,
        facility_type_effective: normalizedOverride ?? inferredFacilityType,
      },
    },
  });

  revalidatePath("/admin/facilities");
  return { success: true };
}

export async function toggleFacilityAdmin(id: string): Promise<{ error?: string; success?: boolean; is_admin?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) return { error: "غير مصرح لك بهذه العملية" };
  if (id === session.id) return { error: "لا يمكن تغيير صلاحياتك الخاصة" };

  const facility = await prisma.facility.findUnique({ where: { id }, select: { is_admin: true, name: true, username: true, deleted_at: true } });
  if (!facility || facility.deleted_at) return { error: "المرفق غير موجود" };

  const newIsAdmin = !facility.is_admin;
  await prisma.facility.update({ where: { id }, data: { is_admin: newIsAdmin } });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "UPDATE_FACILITY",
      metadata: { facility_id: id, name: facility.name, username: facility.username, set_is_admin: newIsAdmin },
    },
  });

  revalidatePath("/admin/facilities");
  return { success: true, is_admin: newIsAdmin };
}

export async function deleteFacility(id: string): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) return { error: "غير مصرح لك بهذه العملية" };
  if (!id) return { error: "معرّف المرفق غير صالح" };
  if (id === session.id) return { error: "لا يمكن حذف الحساب الحالي" };

  // التحقق من وجود عمليات مرتبطة بهذا المرفق
  const txCount = await prisma.transaction.count({ where: { facility_id: id } });
  if (txCount > 0) {
    return { error: `لا يمكن حذف هذا المرفق لأنه يحتوي على ${txCount} عملية مسجّلة` };
  }

  // حذف ناعم — لا نحذف السجل فعلياً
  await prisma.facility.update({
    where: { id },
    data: { deleted_at: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "DELETE_FACILITY",
      metadata: { deleted_facility_id: id },
    },
  });

  revalidatePath("/admin/facilities");
  return { success: true };
}

export async function restoreFacility(id: string): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) return { error: "غير مصرح لك بهذه العملية" };
  if (!id) return { error: "معرّف المرفق غير صالح" };

  const facility = await prisma.facility.findUnique({
    where: { id },
    select: { id: true, deleted_at: true, name: true },
  });
  if (!facility) return { error: "المرفق غير موجود" };
  if (!facility.deleted_at) return { error: "المرفق غير محذوف" };

  await prisma.facility.update({
    where: { id },
    data: { deleted_at: null },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "RESTORE_FACILITY",
      metadata: { restored_facility_id: id, name: facility.name },
    },
  });

  revalidatePath("/admin/facilities");
  return { success: true };
}

export async function permanentlyDeleteFacility(id: string): Promise<{ error?: string; success?: boolean }> {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) return { error: "غير مصرح لك بهذه العملية" };
  if (!id) return { error: "معرّف المرفق غير صالح" };

  const facility = await prisma.facility.findUnique({
    where: { id },
    select: {
      id: true,
      deleted_at: true,
      name: true,
      _count: { select: { transactions: true } },
    },
  });

  if (!facility) return { error: "المرفق غير موجود" };
  if (!facility.deleted_at) return { error: "يجب حذف المرفق حذفا ناعما أولا" };
  if (facility._count.transactions > 0) {
    return { error: `لا يمكن الحذف النهائي — يوجد ${facility._count.transactions} معاملات مرتبطة` };
  }

  const deleted = await prisma.facility.deleteMany({ where: { id } });
  if (deleted.count === 0) {
    return { error: "تعذر تنفيذ الحذف النهائي" };
  }

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "PERMANENT_DELETE_FACILITY",
      metadata: { facility_id: id, name: facility.name },
    },
  });

  revalidatePath("/admin/facilities");
  return { success: true };
}

export async function importFacilitiesFromExcel(formData: FormData): Promise<{
  created?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
}> {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح" };
  }

  const file = formData.get("file") as File | null;
  if (!file) return { error: "لم يتم اختيار ملف" };

  if (!hasPermission(session, "add_facility")) {
    return { error: "غير مصرح لك باستيراد المرافق" };
  }

  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    return { error: "يجب أن يكون الملف بصيغة Excel (.xlsx أو .xls)" };
  }

  if (file.size > 10 * 1024 * 1024) {
    return { error: "حجم الملف يتجاوز الحد المسموح (10 ميجابايت)" };
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { error: "الملف فارغ أو لا يحتوي على بيانات" };

  // استخراج رؤوس الأعمدة من الصف الأول
  const headerRow = sheet.getRow(1);
  const headers: Record<number, string> = {};
  headerRow.eachCell((cell, colNum) => {
    const val = String(cell.value ?? "").trim().toLowerCase();
    headers[colNum] = val;
  });

  // دعم رؤوس عربية وإنجليزية
  const findCol = (keys: string[]) =>
    Object.entries(headers).find(([, v]) => keys.some((k) => v.includes(k)))?.[0];

  const nameColStr = findCol(["name", "اسم المرفق", "الاسم", "مرفق"]);
  const usernameColStr = findCol(["username", "اسم المستخدم", "المستخدم", "user"]);

  if (!nameColStr || !usernameColStr) {
    return {
      error:
        "لم يتم العثور على الأعمدة المطلوبة. يجب أن يحتوي الملف على عمودي: اسم المرفق + اسم المستخدم",
    };
  }

  const nameCol = Number(nameColStr);
  const usernameCol = Number(usernameColStr);

  // ── 1. استخراج وتحقق من جميع الصفوف أولاً ──────────────────────────────
  const validRows: { name: string; username: string }[] = [];
  const rowErrors: string[] = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = String(row.getCell(nameCol).value ?? "").trim();
    const username = String(row.getCell(usernameCol).value ?? "")
      .trim()
      .toLowerCase();

    if (!name && !username) continue; // صف فارغ — تخطّ
    if (!name || !username) {
      rowErrors.push(`الصف ${r}: بيانات ناقصة (الاسم أو اسم المستخدم)`);
      continue;
    }

    if (!/^[a-z0-9_]+$/.test(username)) {
      rowErrors.push(
        `الصف ${r}: اسم المستخدم "${username}" غير صالح (أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط)`
      );
      continue;
    }

    validRows.push({ name, username });
  }

  if (validRows.length === 0 && rowErrors.length === 0) {
    return { error: "الملف لا يحتوي على صفوف قابلة للاستيراد" };
  }

  // ── 2. فحص المستخدمين الموجودين بـ استعلام واحد (batch) ─────────────────
  const usernamesToCheck = validRows.map((r) => r.username);
  const existingFacilities = await prisma.facility.findMany({
    where: { username: { in: usernamesToCheck } },
    select: { username: true },
  });
  const existingUsernames = new Set(existingFacilities.map((f) => f.username));

  const newFacilities = validRows.filter((r) => !existingUsernames.has(r.username));
  const skipped = validRows.length - newFacilities.length;

  // ── 3. كلمة مرور افتراضية (123456) لكل مرفق جديد — يُجبر على تغييرها ──
  const defaultPasswordHash = await bcrypt.hash("123456", 10);
  const facilityData = newFacilities.map((f) => ({
    name: f.name,
    username: f.username,
    password_hash: defaultPasswordHash,
    is_admin: false,
    must_change_password: true,
  }));

  // ── 4. إدراج دفعي (createMany) ──────────────────────────────────────────
  let created = 0;
  if (facilityData.length > 0) {
    const result = await prisma.facility.createMany({
      data: facilityData,
      skipDuplicates: true,
    });
    created = result.count;
  }

  const errors = rowErrors;

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "IMPORT_FACILITIES",
      metadata: { created, skipped, errors: errors.length },
    },
  });

  revalidatePath("/admin/facilities");
  return { created, skipped, errors };
}

