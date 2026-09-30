"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { EQUESTRIAN_CATEGORY_CEILINGS, EQUESTRIAN_CATEGORIES } from "@/lib/constants";

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
        },
        pharmacy_config: true,
        equestrian_config: true,
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
      pharmacy_config: p.pharmacy_config ? {
        ...p.pharmacy_config,
        routine_ceiling: p.pharmacy_config.routine_ceiling === null ? null : Number(p.pharmacy_config.routine_ceiling),
        routine_coverage_percent: p.pharmacy_config.routine_coverage_percent === null ? null : Number(p.pharmacy_config.routine_coverage_percent),
        chronic_ceiling: p.pharmacy_config.chronic_ceiling === null ? null : Number(p.pharmacy_config.chronic_ceiling),
        chronic_coverage_percent: p.pharmacy_config.chronic_coverage_percent === null ? null : Number(p.pharmacy_config.chronic_coverage_percent),
        chemical_ceiling: p.pharmacy_config.chemical_ceiling === null ? null : Number(p.pharmacy_config.chemical_ceiling),
        chemical_coverage_percent: p.pharmacy_config.chemical_coverage_percent === null ? null : Number(p.pharmacy_config.chemical_coverage_percent),
      } : null,
      equestrian_config: p.equestrian_config ? {
        ...p.equestrian_config,
        emergency_ceiling: Number(p.equestrian_config.emergency_ceiling),
        inpatient_surgery_ceiling: Number(p.equestrian_config.inpatient_surgery_ceiling),
      } : null,
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
  pharmacy_config?: {
    default_prescription_limit: number | null;
    routine_enabled: boolean;
    routine_ceiling: number | null;
    routine_coverage_percent: number | null;
    routine_frequency_months: number | null;
    routine_prescription_limit: number | null;
    chronic_enabled: boolean;
    chronic_ceiling: number | null;
    chronic_coverage_percent: number | null;
    chronic_frequency_months: number | null;
    chronic_prescription_limit: number | null;
    chemical_enabled: boolean;
    chemical_ceiling: number | null;
    chemical_coverage_percent: number | null;
    chemical_frequency_months: number | null;
    chemical_prescription_limit: number | null;
    chemical_attachment_required: boolean;
    max_attachments: number;
  };
  equestrian_config?: {
    emergency_ceiling: number;
    inpatient_surgery_ceiling: number;
  };
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

    const selectedServiceType = await prisma.serviceType.findUnique({
      where: { id: data.service_type_id },
      select: { code: true },
    });
    if (!selectedServiceType) return { error: "نوع الخدمة غير موجود." };

    const equestrianEmergencyCeiling = data.equestrian_config?.emergency_ceiling
      ?? EQUESTRIAN_CATEGORY_CEILINGS[EQUESTRIAN_CATEGORIES.EMERGENCY];
    const equestrianInpatientSurgeryCeiling = data.equestrian_config?.inpatient_surgery_ceiling
      ?? EQUESTRIAN_CATEGORY_CEILINGS[EQUESTRIAN_CATEGORIES.INPATIENT_SURGERY];
    if (selectedServiceType.code === "EQUESTRIAN" && (
      !Number.isFinite(equestrianEmergencyCeiling) || equestrianEmergencyCeiling < 0
      || !Number.isFinite(equestrianInpatientSurgeryCeiling) || equestrianInpatientSurgeryCeiling < 0
    )) {
      return { error: "سقوف الفروسية يجب أن تكون أرقاماً موجبة أو صفراً." };
    }
    const ceilingAmount = selectedServiceType.code === "EQUESTRIAN"
      ? equestrianEmergencyCeiling + equestrianInpatientSurgeryCeiling
      : data.ceiling_amount;

    if (!Number.isFinite(data.coverage_percent) || data.coverage_percent < 0 || data.coverage_percent > 100) {
      return { error: "نسبة التغطية الافتراضية يجب أن تكون بين 0 و100." };
    }
    if (selectedServiceType.code === "MEDICINE" && data.frequency_months !== null && (!Number.isInteger(data.frequency_months) || data.frequency_months < 1 || data.frequency_months > 12)) {
      return { error: "دورة التجديد الافتراضية للصيدلية يجب أن تكون من شهر إلى 12 شهرًا." };
    }
    if (selectedServiceType.code === "MEDICINE" && data.pharmacy_config) {
      const config = data.pharmacy_config;
      if (!config.routine_enabled && !config.chronic_enabled && !config.chemical_enabled) {
        return { error: "يجب تفعيل تصنيف دوائي واحد على الأقل." };
      }
      const overrides = [
        [config.routine_coverage_percent, config.routine_frequency_months],
        [config.chronic_coverage_percent, config.chronic_frequency_months],
        [config.chemical_coverage_percent, config.chemical_frequency_months],
      ];
      if (overrides.some(([coverage]) => coverage !== null && (!Number.isFinite(coverage) || coverage < 0 || coverage > 100))) {
        return { error: "نسبة تغطية التصنيف يجب أن تكون بين 0 و100 أو تُترك فارغة للوراثة." };
      }
      if (overrides.some(([, frequency]) => frequency !== null && (!Number.isInteger(frequency) || frequency < 1 || frequency > 12))) {
        return { error: "دورة تجديد التصنيف يجب أن تكون من شهر إلى 12 شهرًا أو تُترك افتراضية." };
      }
      const prescriptionLimits = [
        config.default_prescription_limit,
        config.routine_prescription_limit,
        config.chronic_prescription_limit,
        config.chemical_prescription_limit,
      ];
      if (prescriptionLimits.some((limit) => limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 4))) {
        return { error: "عدد الوصفات يجب أن يكون بين 1 و4 أو يُترك فارغًا." };
      }
    }

    const pharmacyConfig = selectedServiceType.code === "MEDICINE"
      ? {
          default_prescription_limit: data.pharmacy_config?.default_prescription_limit ?? null,
          routine_enabled: data.pharmacy_config?.routine_enabled ?? true,
          routine_ceiling: data.pharmacy_config?.routine_ceiling ?? ceilingAmount,
          routine_coverage_percent: data.pharmacy_config?.routine_coverage_percent ?? null,
          routine_frequency_months: data.pharmacy_config?.routine_frequency_months ?? null,
          routine_prescription_limit: data.pharmacy_config?.routine_prescription_limit ?? null,
          chronic_enabled: data.pharmacy_config?.chronic_enabled ?? true,
          chronic_ceiling: data.pharmacy_config?.chronic_ceiling ?? ceilingAmount,
          chronic_coverage_percent: data.pharmacy_config?.chronic_coverage_percent ?? null,
          chronic_frequency_months: data.pharmacy_config?.chronic_frequency_months ?? null,
          chronic_prescription_limit: data.pharmacy_config?.chronic_prescription_limit ?? null,
          chemical_enabled: data.pharmacy_config?.chemical_enabled ?? false,
          chemical_ceiling: data.pharmacy_config?.chemical_ceiling ?? ceilingAmount,
          chemical_coverage_percent: data.pharmacy_config?.chemical_coverage_percent ?? null,
          chemical_frequency_months: data.pharmacy_config?.chemical_frequency_months ?? null,
          chemical_prescription_limit: data.pharmacy_config?.chemical_prescription_limit ?? null,
          chemical_attachment_required: data.pharmacy_config?.chemical_attachment_required ?? true,
          max_attachments: Math.min(5, Math.max(1, data.pharmacy_config?.max_attachments ?? 2)),
        }
      : null;

    const policy = await prisma.$transaction(async (tx) => {
      const savedPolicy = data.id ? await tx.servicePolicy.update({
        where: { id: data.id },
        data: {
          company_id: data.company_id,
          service_type_id: data.service_type_id,
          ceiling_amount: ceilingAmount,
          coverage_percent: data.coverage_percent,
          frequency_months: data.frequency_months,
          is_active: data.is_active
        }
      }) : await tx.servicePolicy.create({
        data: {
          company_id: data.company_id,
          service_type_id: data.service_type_id,
          ceiling_amount: ceilingAmount,
          coverage_percent: data.coverage_percent,
          frequency_months: data.frequency_months,
          is_active: data.is_active
        }
      });

      if (pharmacyConfig) {
        await tx.pharmacyPolicyConfig.upsert({
          where: { service_policy_id: savedPolicy.id },
          create: { service_policy_id: savedPolicy.id, ...pharmacyConfig },
          update: pharmacyConfig,
        });
      }
      if (selectedServiceType.code === "EQUESTRIAN") {
        await tx.equestrianPolicyConfig.upsert({
          where: { service_policy_id: savedPolicy.id },
          create: {
            service_policy_id: savedPolicy.id,
            emergency_ceiling: equestrianEmergencyCeiling,
            inpatient_surgery_ceiling: equestrianInpatientSurgeryCeiling,
          },
          update: {
            emergency_ceiling: equestrianEmergencyCeiling,
            inpatient_surgery_ceiling: equestrianInpatientSurgeryCeiling,
          },
        });
      }
      return savedPolicy;
    });

    revalidatePath("/admin/service-policies");
    revalidatePath("/admin/pharmacy-services");
    
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
