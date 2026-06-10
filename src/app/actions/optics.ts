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
        company: {
          select: {
            service_policies: {
              where: { service_type: { code: "OPTICS" } },
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
        const opticsCeiling = policy?.ceiling_amount !== null && policy?.ceiling_amount !== undefined ? Number(policy.ceiling_amount) : 3000;
        return {
          id: r.id,
          name: r.name,
          card_number: r.card_number,
          status: r.status,
          remaining_balance: opticsCeiling,
          total_balance: opticsCeiling,
        };
      })
    };
  } catch (error) {
    logger.error("Search company beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ البحث", items: [] };
  }
}

export async function getOpticsBeneficiaryDetail(beneficiaryId: string, companyId: string) {
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
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            logo: true,
            service_policies: {
              where: { service_type: { code: "OPTICS" } },
              select: { ceiling_amount: true, coverage_percent: true, frequency_months: true }
            },
            optics_settings: true
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

    // حساب الاستهلاك خلال فترة التغطية
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - frequencyMonths);

    const agg = await prisma.transaction.aggregate({
      where: {
        beneficiary_id: beneficiary.id,
        company_id: companyId,
        type: "OPTICS",
        is_cancelled: false,
        created_at: { gte: startDate, lte: endDate },
      },
      _sum: { ceiling_consumed: true },
    });

    const yearlyConsumed = Number(agg._sum.ceiling_consumed ?? 0);

    const opticsCeiling = policy?.ceiling_amount !== null && policy?.ceiling_amount !== undefined
      ? Number(policy.ceiling_amount)
      : (beneficiary.company ? null : 3000);

    const dynamicRemaining = opticsCeiling === null ? null : Math.max(0, opticsCeiling - yearlyConsumed);
    const dynamicStatus = beneficiary.status === "SUSPENDED"
      ? "SUSPENDED"
      : (dynamicRemaining !== null && dynamicRemaining <= 0 ? "FINISHED" : "ACTIVE");

    return {
      success: true,
      beneficiary: {
        id: beneficiary.id,
        name: beneficiary.name,
        card_number: beneficiary.card_number,
        status: dynamicStatus,
        remaining_balance: dynamicRemaining,
        total_balance: opticsCeiling,
        company: beneficiary.company
      },
      yearlyConsumed
    };
  } catch (error) {
    logger.error("Get optics beneficiary detail error", { error: String(error) });
    return { error: "تعذر جلب تفاصيل المستفيد" };
  }
}
