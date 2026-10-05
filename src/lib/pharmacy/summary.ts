import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  getNextChronicEligibleDate,
  getPolicyYearWindow,
  getTripoliDayWindow,
  isChronicDrugEligible,
  resolvePharmacyCategoryPolicy,
  type MedicineCategoryValue,
} from "@/lib/pharmacy/policy";

/**
 * الصرف "الساري" يُعرف من الدفتر المالي نفسه: حالة الصرف مكتملة وحركته غير ملغاة.
 * بهذا لا ينشأ انجراف إن أُلغيت الحركة من أي شاشة (الحركات العامة أو الصيدلية): السقف والمزمن يتبعان الدفتر تلقائيًا.
 */
export const ACTIVE_DISPENSE = { status: "COMPLETED", transaction: { is_cancelled: false } } as const;

export type PharmacyClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export async function loadPharmacyPolicy(client: PharmacyClient, companyId: string) {
  return client.servicePolicy.findFirst({
    where: { company_id: companyId, service_type: { code: "MEDICINE" }, is_active: true },
    include: { pharmacy_config: true },
  });
}

/** استهلاك السقف خلال السنة التأمينية: للفئة وللخدمة كاملة، من الصرفيات المكتملة. */
export async function getPharmacyConsumption(client: PharmacyClient, beneficiaryId: string, category: MedicineCategoryValue, window: { start: Date; end: Date }) {
  const rows = await client.pharmacyDispense.groupBy({
    by: ["medicine_category"],
    where: { beneficiary_id: beneficiaryId, ...ACTIVE_DISPENSE, created_at: { gte: window.start, lt: window.end } },
    _sum: { gross_total: true },
  });
  const overall = rows.reduce((sum, row) => sum.plus(row._sum.gross_total ?? 0), new Prisma.Decimal(0));
  const categoryRow = rows.find((row) => row.medicine_category === category);
  return { overall, category: new Prisma.Decimal(categoryRow?._sum.gross_total ?? 0) };
}

export type PharmacyCategoryUsage = {
  category: MedicineCategoryValue;
  enabled: boolean;
  coveragePercent: number;
  categoryCeiling: number | null;
  overallCeiling: number | null;
  consumedCategory: number;
  consumedOverall: number;
  remaining: number | null;
  dailyLimit: number | null;
  todayCount: number | null;
};

/** ملخص السقوف والحدود لكل فئة: تستخدمه نافذة الصرف وبوابة المستفيد بنفس الحساب. */
export async function getPharmacyUsage(beneficiaryId: string, companyId: string, now = new Date()) {
  const policy = await loadPharmacyPolicy(prisma, companyId);
  const config = policy?.pharmacy_config;
  if (!policy || !config) return { usage: null, chronicIntervalDays: 28 };

  const window = getPolicyYearWindow(now, config.policy_year_start_month);
  const today = getTripoliDayWindow(now);
  const categories: PharmacyCategoryUsage[] = await Promise.all((["ROUTINE", "CHRONIC", "CHEMICAL"] as const).map(async (category) => {
    const resolved = resolvePharmacyCategoryPolicy(policy, config, category);
    const consumption = await getPharmacyConsumption(prisma, beneficiaryId, category, window);
    const todayCount = resolved.dailyLimit === null ? null : await prisma.pharmacyPrescription.count({
      where: { beneficiary_id: beneficiaryId, medicine_category: category, status: { not: "CANCELLED" }, created_at: { gte: today.start, lt: today.end } },
    });
    const remaining = [
      resolved.categoryCeiling === null ? null : resolved.categoryCeiling - Number(consumption.category),
      resolved.overallCeiling === null ? null : resolved.overallCeiling - Number(consumption.overall),
    ].filter((value): value is number => value !== null);
    return {
      category,
      enabled: resolved.enabled,
      coveragePercent: resolved.coveragePercent,
      categoryCeiling: resolved.categoryCeiling,
      overallCeiling: resolved.overallCeiling,
      consumedCategory: Number(consumption.category),
      consumedOverall: Number(consumption.overall),
      remaining: remaining.length === 0 ? null : Math.max(0, Math.min(...remaining)),
      dailyLimit: resolved.dailyLimit,
      todayCount,
    };
  }));
  return {
    usage: { policyYearStart: window.start.toISOString(), policyYearEnd: window.end.toISOString(), categories },
    chronicIntervalDays: config.chronic_interval_days,
  };
}

export type ChronicDrugStatus = {
  id: string;
  drug_id: string;
  drug_name: string;
  notes: string | null;
  last_dispensed_at: string | null;
  last_facility_name: string | null;
  last_price: number | null;
  eligible: boolean;
  next_eligible_at: string | null;
};

/** الأدوية المزمنة المرتبطة بالمستفيد مع آخر صرف لكل دواء (من أي مرفق) وموعد الأهلية التالي. */
export async function getChronicDrugStatuses(beneficiaryId: string, intervalDays: number, now = new Date()): Promise<ChronicDrugStatus[]> {
  const links = await prisma.beneficiaryChronicDrug.findMany({
    where: { beneficiary_id: beneficiaryId, active: true },
    orderBy: [{ sort_order: "asc" }, { created_at: "asc" }],
    select: { id: true, notes: true, drug: { select: { id: true, name: true } } },
  });
  if (links.length === 0) return [];
  const lastItems = await prisma.pharmacyDispenseItem.findMany({
    where: { drug_id: { in: links.map((link) => link.drug.id) }, dispense: { beneficiary_id: beneficiaryId, medicine_category: "CHRONIC", ...ACTIVE_DISPENSE } },
    orderBy: { dispense: { created_at: "desc" } },
    distinct: ["drug_id"],
    select: { drug_id: true, price: true, dispense: { select: { created_at: true, facility: { select: { name: true } } } } },
  });
  const lastByDrug = new Map(lastItems.map((item) => [item.drug_id, item]));
  return links.map((link) => {
    const last = lastByDrug.get(link.drug.id);
    const lastAt = last?.dispense.created_at ?? null;
    return {
      id: link.id,
      drug_id: link.drug.id,
      drug_name: link.drug.name,
      notes: link.notes,
      last_dispensed_at: lastAt?.toISOString() ?? null,
      last_facility_name: last?.dispense.facility.name ?? null,
      last_price: last ? Number(last.price) : null,
      eligible: isChronicDrugEligible(lastAt, intervalDays, now),
      next_eligible_at: lastAt ? getNextChronicEligibleDate(lastAt, intervalDays).toISOString() : null,
    };
  });
}
