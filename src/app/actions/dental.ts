"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { getArabicNormalization } from "@/lib/normalize";
import { logger } from "@/lib/logger";

export async function searchCompanyBeneficiaries(query: string, companyId: string) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح", items: [] };
  }

  const rateLimitError = await checkRateLimit(`search:${session.id}`, "search");
  if (rateLimitError) return { error: rateLimitError, items: [] };

  const q = query.trim();
  if (q.length < 2 || q.length > 100) {
    return { items: [] };
  }

  try {
    const normalizedQ = getArabicNormalization(q);
    const likePattern = `%${q}%`;
    const normalizedPattern = `%${normalizedQ}%`;

    // البحث عن مستفيدي هذه الشركة فقط
    const rows = await prisma.beneficiary.findMany({
      where: {
        company_id: companyId,
        deleted_at: null,
        status: { in: ["ACTIVE", "FINISHED"] },
        company: { is_active: true, deleted_at: null },
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { name: { contains: normalizedQ, mode: "insensitive" } },
          { card_number: { contains: q, mode: "insensitive" } }
        ]
      },
      select: {
        id: true,
        name: true,
        card_number: true,
        status: true,
        remaining_balance: true,
        total_balance: true,
        custom_ceilings: true,
        company: {
          select: {
            service_policies: {
              where: { service_type: { code: "DENTAL" } },
              select: { ceiling_amount: true, coverage_percent: true, frequency_months: true }
            }
          }
        }
      },
      orderBy: { name: "asc" },
      take: 20
    });

    return {
      items: rows.map(r => {
        const policy = r.company?.service_policies?.[0];
        let dentalCeiling = policy?.ceiling_amount !== null && policy?.ceiling_amount !== undefined ? Number(policy.ceiling_amount) : 3000;
        let hasCustomCeiling = false;
        
        if (r.custom_ceilings && typeof r.custom_ceilings === "object" && "DENTAL" in (r.custom_ceilings as any)) {
          const cVal = (r.custom_ceilings as any).DENTAL;
          dentalCeiling = cVal === null ? 99999999 : Number(cVal);
          hasCustomCeiling = true;
        }
        return {
          id: r.id,
          name: r.name,
          card_number: r.card_number,
          status: r.status,
          remaining_balance: dentalCeiling,
          total_balance: dentalCeiling,
          hasCustomCeiling,
        };
      })
    };
  } catch (error) {
    logger.error("Search company beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ البحث", items: [] };
  }
}

export async function getDentalBeneficiaryDetail(beneficiaryId: string, companyId: string) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح" };
  }

  try {
    const rawBeneficiary = await prisma.beneficiary.findFirst({
      where: {
        id: beneficiaryId,
        company_id: companyId,
        deleted_at: null,
        company: { is_active: true, deleted_at: null }
      },
      select: {
        id: true,
        name: true,
        card_number: true,
        status: true,
        remaining_balance: true,
        total_balance: true,
        custom_ceilings: true,
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            logo: true,
            service_policies: {
              where: { service_type: { code: "DENTAL" } },
              select: { ceiling_amount: true, coverage_percent: true, frequency_months: true }
            },
            dental_settings: true,
            service_aliases: true
          } as any
        }
      }
    });

    const beneficiary = rawBeneficiary as any;

    if (!beneficiary) {
      return { error: "المستفيد غير موجود" };
    }

    const policy = beneficiary.company?.service_policies?.[0];
    const frequencyMonths = policy?.frequency_months || 12;

    // حساب الاستهلاك خلال فترة التغطية (يغطي حتى نهاية العام لضمان ظهور الحركات المستقبلية المدخلة يدوياً)
    const endDate = new Date();
    endDate.setMonth(11, 31); // Dec 31
    endDate.setHours(23, 59, 59, 999);
    
    const startDate = new Date();
    startDate.setMonth(new Date().getMonth() - frequencyMonths);

    const agg = await prisma.transaction.aggregate({
      where: {
        beneficiary_id: beneficiary.id,
        company_id: companyId,
        type: "DENTAL",
        is_cancelled: false,
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: { ceiling_consumed: true },
    });

    const yearlyConsumed = Number(agg._sum.ceiling_consumed ?? 0);

    let dentalCeiling = policy?.ceiling_amount !== null && policy?.ceiling_amount !== undefined
      ? Number(policy.ceiling_amount)
      : (beneficiary.company ? null : 3000);

    let hasCustomCeiling = false;
    if (beneficiary.custom_ceilings && typeof beneficiary.custom_ceilings === "object" && "DENTAL" in beneficiary.custom_ceilings) {
      const cVal = (beneficiary.custom_ceilings as any).DENTAL;
      dentalCeiling = cVal === null ? null : Number(cVal);
      hasCustomCeiling = true;
    }

    const dynamicRemaining = dentalCeiling === null ? null : Math.max(0, dentalCeiling - yearlyConsumed);
    const dynamicStatus = beneficiary.status === "SUSPENDED"
      ? "SUSPENDED"
      : (dynamicRemaining !== null && dynamicRemaining <= 0 ? "FINISHED" : "ACTIVE");

    const companyData = beneficiary.company ? {
      ...beneficiary.company,
      service_policies: beneficiary.company.service_policies?.map((p: any) => ({
        ...p,
        ceiling_amount: p.ceiling_amount !== null ? Number(p.ceiling_amount) : null,
        coverage_percent: p.coverage_percent !== null ? Number(p.coverage_percent) : null,
      }))
    } : null;

    return {
      success: true,
      beneficiary: {
        id: beneficiary.id,
        name: beneficiary.name,
        card_number: beneficiary.card_number,
        status: dynamicStatus,
        remaining_balance: dynamicRemaining,
        total_balance: dentalCeiling,
        hasCustomCeiling,
        company: companyData
      },
      yearlyConsumed
    };
  } catch (error) {
    logger.error("Get dental beneficiary detail error", { error: String(error) });
    return { error: "تعذر جلب تفاصيل المستفيد" };
  }
}
