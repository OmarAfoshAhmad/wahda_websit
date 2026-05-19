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
        status: "ACTIVE",
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
      },
      orderBy: { name: "asc" },
      take: 20
    });

    return {
      items: rows.map(r => ({
        id: r.id,
        name: r.name,
        card_number: r.card_number,
        status: r.status,
        remaining_balance: Number(r.remaining_balance),
        total_balance: Number(r.total_balance),
      }))
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
    const beneficiary = await prisma.beneficiary.findFirst({
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
            logo: true
          }
        }
      }
    });

    if (!beneficiary) {
      return { error: "المستفيد غير موجود" };
    }

    // حساب الاستهلاك السنوي لخدمات الأسنان
    const fiscalYear = new Date().getFullYear();
    const startDate = new Date(fiscalYear, 0, 1);
    const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

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

    return {
      success: true,
      beneficiary: {
        id: beneficiary.id,
        name: beneficiary.name,
        card_number: beneficiary.card_number,
        status: beneficiary.status,
        remaining_balance: Number(beneficiary.remaining_balance),
        total_balance: Number(beneficiary.total_balance),
        company: beneficiary.company
      },
      yearlyConsumed
    };
  } catch (error) {
    logger.error("Get dental beneficiary detail error", { error: String(error) });
    return { error: "تعذر جلب تفاصيل المستفيد" };
  }
}
