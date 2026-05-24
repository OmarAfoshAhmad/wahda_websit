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
  dental_ceiling?: number | null;
  dental_coverage?: number;
  general_ceiling?: number | null;
  general_coverage?: number;
  medicine_ceiling?: number | null;
  medicine_coverage?: number;
  dental_settings?: any;
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
        dental_ceiling: data.dental_ceiling !== undefined ? data.dental_ceiling : 3000,
        dental_coverage: data.dental_coverage !== undefined ? data.dental_coverage : 100,
        general_ceiling: data.general_ceiling !== undefined ? data.general_ceiling : null,
        general_coverage: data.general_coverage !== undefined ? data.general_coverage : 80,
        medicine_ceiling: data.medicine_ceiling !== undefined ? data.medicine_ceiling : null,
        medicine_coverage: data.medicine_coverage !== undefined ? data.medicine_coverage : 80,
        dental_settings: data.dental_settings,
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
  dental_ceiling?: number | null;
  dental_coverage?: number;
  general_ceiling?: number | null;
  general_coverage?: number;
  medicine_ceiling?: number | null;
  medicine_coverage?: number;
  dental_settings?: any;
}) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin && !hasPermission(session!, "manage_companies")) {
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
        name: data.name,
        card_pattern: data.card_pattern,
        logo: data.logo,
        is_active: data.is_active,
        dental_ceiling: data.dental_ceiling,
        dental_coverage: data.dental_coverage,
        general_ceiling: data.general_ceiling,
        general_coverage: data.general_coverage,
        medicine_ceiling: data.medicine_ceiling,
        medicine_coverage: data.medicine_coverage,
        dental_settings: data.dental_settings,
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

export async function purgeUnusedBeneficiaries(companyId: string) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin && !session?.is_manager) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  try {
    // 1. Find all beneficiaries for this company that have zero transactions
    const beneficiaries = await prisma.beneficiary.findMany({
      where: {
        company_id: companyId,
        transactions: {
          none: {}
        }
      },
      select: { id: true }
    });

    const ids = beneficiaries.map((b) => b.id);

    if (ids.length === 0) {
      return { success: true, count: 0, message: "لا يوجد مستفيدون بدون حركات لهذه الشركة." };
    }

    // 2. Perform deletion in a transaction to ensure database integrity
    await prisma.$transaction([
      prisma.walletConsumption.deleteMany({
        where: { beneficiary_id: { in: ids } }
      }),
      prisma.notification.deleteMany({
        where: { beneficiary_id: { in: ids } }
      }),
      prisma.claim.deleteMany({
        where: { beneficiary_id: { in: ids } }
      }),
      prisma.beneficiary.deleteMany({
        where: { id: { in: ids } }
      })
    ]);

    revalidatePath("/admin/companies");
    return { success: true, count: ids.length };
  } catch (error) {
    console.error("Purge unused beneficiaries error:", error);
    return { error: "تعذر تنظيف وتطهير المستفيدين غير المستخدمين" };
  }
}
