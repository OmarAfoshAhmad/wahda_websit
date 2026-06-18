"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";

// 1. Get all policies
export async function getServicePolicies() {
  const session = await getSessionWithFreshPermissions();
  if (!session || (!session.is_admin && !hasPermission(session, "manage_companies"))) {
    return { error: "غير مصرح" };
  }

  try {
    const policies = await prisma.servicePolicy.findMany({
      include: {
        company: {
          select: { id: true, name: true, code: true, is_active: true }
        },
        service_type: {
          select: { id: true, name: true, code: true }
        }
      },
      orderBy: [
        { company: { name: "asc" } },
        { service_type: { name: "asc" } }
      ]
    });

    const serviceTypes = await prisma.serviceType.findMany({
      where: { is_active: true },
      orderBy: { name: "asc" }
    });

    const companies = await prisma.insuranceCompany.findMany({
      where: { is_active: true, deleted_at: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true }
    });

    const serializedPolicies = policies.map((p) => ({
      ...p,
      ceiling_amount: p.ceiling_amount !== null ? Number(p.ceiling_amount) : null,
      coverage_percent: Number(p.coverage_percent),
    }));

    return { policies: serializedPolicies, serviceTypes, companies };
  } catch (error: any) {
    console.error("Error fetching service policies:", error);
    return { error: "حدث خطأ أثناء جلب السياسات." };
  }
}

// 2. Upsert Policy
export async function upsertServicePolicy(data: {
  id?: string;
  company_id: string;
  service_type_id: string;
  ceiling_amount: number | null;
  coverage_percent: number;
  frequency_months: number | null;
  is_active: boolean;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session || (!session.is_admin && !hasPermission(session, "manage_companies"))) {
    return { error: "غير مصرح" };
  }

  try {
    // Ensure unique constraint per company & service type
    const existing = await prisma.servicePolicy.findFirst({
      where: {
        company_id: data.company_id,
        service_type_id: data.service_type_id,
        id: data.id ? { not: data.id } : undefined
      }
    });

    if (existing) {
      return { error: "توجد سياسة لهذه الشركة ونوع الخدمة بالفعل." };
    }

    let policy;
    if (data.id) {
      policy = await prisma.servicePolicy.update({
        where: { id: data.id },
        data: {
          company_id: data.company_id,
          service_type_id: data.service_type_id,
          ceiling_amount: data.ceiling_amount,
          coverage_percent: data.coverage_percent,
          frequency_months: data.frequency_months,
          is_active: data.is_active
        }
      });
    } else {
      policy = await prisma.servicePolicy.create({
        data: {
          company_id: data.company_id,
          service_type_id: data.service_type_id,
          ceiling_amount: data.ceiling_amount,
          coverage_percent: data.coverage_percent,
          frequency_months: data.frequency_months,
          is_active: data.is_active
        }
      });
    }

    revalidatePath("/admin/service-policies");
    
    const serializedPolicy = {
      ...policy,
      ceiling_amount: policy.ceiling_amount !== null ? Number(policy.ceiling_amount) : null,
      coverage_percent: Number(policy.coverage_percent),
    };

    return { success: true, policy: serializedPolicy };
  } catch (error: any) {
    console.error("Error upserting service policy:", error);
    return { error: "حدث خطأ أثناء حفظ السياسة." };
  }
}

// 3. Delete Policy
export async function deleteServicePolicy(id: string) {
  const session = await getSessionWithFreshPermissions();
  if (!session || (!session.is_admin && !hasPermission(session, "manage_companies"))) {
    return { error: "غير مصرح" };
  }

  try {
    await prisma.servicePolicy.delete({
      where: { id }
    });

    revalidatePath("/admin/service-policies");
    return { success: true };
  } catch (error: any) {
    console.error("Error deleting service policy:", error);
    return { error: "حدث خطأ أثناء حذف السياسة." };
  }
}
