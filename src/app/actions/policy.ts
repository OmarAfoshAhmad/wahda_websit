"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

export async function createOrUpdatePolicy(data: {
  company_id: string;
  service_type: string;
  annual_ceiling: number | null;
  copay_percentage: number;
  allow_partial_coverage?: boolean;
  is_active?: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
}) {
  const session = await requireActiveFacilitySession();
  // SEC-06 FIX: يتطلب صلاحية manage_companies بدل أي مدير
  if (!session?.is_admin && !hasPermission(session!, 'manage_companies')) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  try {
    const policy = await prisma.servicePolicy.upsert({
      where: {
        company_id_service_type: {
          company_id: data.company_id,
          service_type: data.service_type,
        },
      },
      update: {
        annual_ceiling: data.annual_ceiling,
        copay_percentage: data.copay_percentage,
        allow_partial_coverage: data.allow_partial_coverage ?? true,
        is_active: data.is_active ?? true,
        effective_from: data.effective_from ? new Date(data.effective_from) : undefined,
        effective_to: data.effective_to ? new Date(data.effective_to) : undefined,
      },
      create: {
        company_id: data.company_id,
        service_type: data.service_type,
        annual_ceiling: data.annual_ceiling,
        copay_percentage: data.copay_percentage,
        allow_partial_coverage: data.allow_partial_coverage ?? true,
        is_active: data.is_active ?? true,
        effective_from: data.effective_from ? new Date(data.effective_from) : null,
        effective_to: data.effective_to ? new Date(data.effective_to) : null,
      },
    });
    revalidatePath("/admin/policies");
    return { success: true, policy };
  } catch (error) {
    return { error: "تعذر حفظ سياسة الخدمة" };
  }
}

export async function deletePolicy(id: string) {
  const session = await requireActiveFacilitySession();
  // SEC-06 FIX: يتطلب صلاحية manage_companies
  if (!session?.is_admin && !hasPermission(session!, 'manage_companies')) {
    return { error: "غير مصرح لك بهذه العملية" };
  }

  try {
    await prisma.servicePolicy.delete({ where: { id } });
    revalidatePath("/admin/policies");
    return { success: true };
  } catch (error) {
    return { error: "تعذر حذف السياسة" };
  }
}
