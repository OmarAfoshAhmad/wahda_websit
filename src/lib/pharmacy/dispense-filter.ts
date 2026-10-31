import type { MedicineCategory, Prisma } from "@prisma/client";
import { getEndOfDayTripoli, getStartOfDayTripoli } from "@/lib/datetime";
import { getArabicSearchTerms } from "@/lib/search";

export const DISPENSE_CATEGORIES: Record<MedicineCategory, string> = { ROUTINE: "روتيني", CHRONIC: "مزمن", CHEMICAL: "أورام" };

/** معايير قائمة حركات الصيدلية (من الرابط)؛ نفسها للجدول وللكشف المطبوع ولتصدير Excel. */
export type DispenseFilterParams = { q?: string; view?: string; category?: string; company?: string; facility?: string; from?: string; to?: string; page?: string };

export const ACTIVE_DISPENSE_WHERE: Prisma.PharmacyDispenseWhereInput = { status: "COMPLETED", transaction: { is_cancelled: false } };
export const DELETED_DISPENSE_WHERE: Prisma.PharmacyDispenseWhereInput = { OR: [{ status: "CANCELLED" }, { transaction: { is_cancelled: true } }] };

/**
 * شرط البحث: نطاق شركات المستخدم، والمرفق يرى صرفه فقط، ثم الفلاتر.
 * base بلا عرض (سارية/محذوفة) لحساب عدد المحذوفة.
 */
export function buildDispenseWhere(params: DispenseFilterParams, scope: { allowedCompanyIds: string[]; facilityId: string | null }) {
  const base: Prisma.PharmacyDispenseWhereInput = {
    company_id: params.company && scope.allowedCompanyIds.includes(params.company) ? params.company : { in: scope.allowedCompanyIds },
    ...(scope.facilityId ? { facility_id: scope.facilityId } : {}),
  };
  const and: Prisma.PharmacyDispenseWhereInput[] = [];
  if (params.category && params.category in DISPENSE_CATEGORIES) and.push({ medicine_category: params.category as MedicineCategory });
  const query = params.q?.trim().slice(0, 100) ?? "";
  if (query) {
    and.push({ OR: getArabicSearchTerms(query).flatMap((term) => [{ beneficiary: { name: { contains: term, mode: "insensitive" as const } } }, { beneficiary: { card_number: { contains: term, mode: "insensitive" as const } } }]) });
  }
  const facility = params.facility?.trim().slice(0, 100);
  if (facility && !scope.facilityId) and.push({ facility: { name: { contains: facility, mode: "insensitive" } } });
  if (params.from || params.to) {
    and.push({ created_at: { ...(params.from ? { gte: getStartOfDayTripoli(params.from) } : {}), ...(params.to ? { lte: getEndOfDayTripoli(params.to) } : {}) } });
  }
  const filtered: Prisma.PharmacyDispenseWhereInput = and.length ? { ...base, AND: and } : base;
  const deletedView = params.view === "deleted";
  return { filtered, deletedView, where: { AND: [filtered, deletedView ? DELETED_DISPENSE_WHERE : ACTIVE_DISPENSE_WHERE] } as Prisma.PharmacyDispenseWhereInput };
}

/** الفلاتر كنص استعلام (بلا الصفحة) لروابط الطباعة والتصدير. */
export function dispenseFilterQuery(params: DispenseFilterParams, extra: Record<string, string> = {}) {
  const entries = Object.entries({ ...params, ...extra }).filter(([key, value]) => value && key !== "page" && key !== "tab") as Array<[string, string]>;
  return new URLSearchParams(entries).toString();
}
