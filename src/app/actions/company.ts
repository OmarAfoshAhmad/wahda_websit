"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { clearAllCaches } from "@/lib/insurance/company-matcher";

export async function createCompany(data: {
  name: string;
  code: string;
  card_pattern?: string;
  logo?: string;
}) {
  const session = await requireActiveFacilitySession();
  // SEC-05 FIX: يتطلب صلاحية manage_companies بدل أي مدير
  if (!session?.is_admin && !hasPermission(session!, 'manage_companies')) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  if (data.card_pattern) {
    try {
      new RegExp(data.card_pattern);
    } catch (e) {
      return { error: "صيغة المطابقة (Regex) غير صحيحة" };
    }
  }

  try {
    const company = await prisma.insuranceCompany.create({
      data: {
        name: data.name,
        code: data.code.toUpperCase(),
        card_pattern: data.card_pattern,
        logo: data.logo,
        is_active: true,
      },
    });
    revalidatePath("/admin/companies");
    clearAllCaches(); // TPA-04: إعادة تحميل كاش الشركات فوراً
    return { success: true, company };
  } catch (error: any) {
    if (error.code === "P2002") {
      return { error: "كود الشركة مستخدم بالفعل" };
    }
    return { error: "تعذر إضافة الشركة" };
  }
}

export async function updateCompany(id: string, data: {
  name?: string;
  code?: string;
  card_pattern?: string;
  logo?: string;
  is_active?: boolean;
}) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin && !session?.is_manager) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  if (data.card_pattern) {
    try {
      new RegExp(data.card_pattern);
    } catch (e) {
      return { error: "صيغة المطابقة (Regex) غير صحيحة" };
    }
  }

  try {
    await prisma.insuranceCompany.update({
      where: { id },
      data: {
        ...data,
        ...(data.code ? { code: data.code.toUpperCase() } : {}),
      },
    });
    revalidatePath("/admin/companies");
    clearAllCaches(); // TPA-04: إعادة تحميل كاش الشركات فوراً
    return { success: true };
  } catch (error) {
    return { error: "تعذر تحديث بيانات الشركة" };
  }
}

export async function toggleCompanyStatus(id: string, currentStatus: boolean) {
  return updateCompany(id, { is_active: !currentStatus });
}

export async function softDeleteCompany(id: string) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  try {
    // 1. التحقق من وجود حركات خصم مسجلة على الشركة
    const transactionCount = await prisma.transaction.count({
      where: { company_id: id }
    });

    if (transactionCount > 0) {
      return { error: "لا يمكن حذف الشركة لوجود حركات خصم مسجلة عليها" };
    }

    // 2. حذف الشركة (Soft Delete)
    await prisma.insuranceCompany.update({
      where: { id },
      data: { deleted_at: new Date(), is_active: false },
    });

    // 3. حذف جميع المستفيدين النشطين التابعين للشركة (Soft Delete)
    await prisma.beneficiary.updateMany({
      where: { company_id: id, deleted_at: null },
      data: { deleted_at: new Date() }
    });

    revalidatePath("/admin/companies");
    clearAllCaches(); // TPA-04: إعادة تحميل كاش الشركات فوراً
    return { success: true };
  } catch (error) {
    console.error("Soft delete company error:", error);
    return { error: "تعذر حذف الشركة" };
  }
}
