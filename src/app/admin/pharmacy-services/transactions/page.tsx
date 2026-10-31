import Link from "next/link";
import { redirect } from "next/navigation";
import type { MedicineCategory, Prisma } from "@prisma/client";
import { ArrowRight, Receipt, Trash2 } from "lucide-react";
import { Shell } from "@/components/shell";
import { Card } from "@/components/ui";
import { PaginationButtons } from "@/components/ui/pagination";
import prisma from "@/lib/prisma";
import { canAccessAdmin } from "@/lib/permissions";
import { getAllowedCompanyIds } from "@/lib/company-scope";
import { getEndOfDayTripoli, getStartOfDayTripoli } from "@/lib/datetime";
import { getArabicSearchTerms } from "@/lib/search";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { getTripoliDayWindow } from "@/lib/pharmacy/policy";
import { DispenseTable } from "./dispense-table";

const PAGE_SIZE = 25;
const CATEGORIES: Record<MedicineCategory, string> = { ROUTINE: "روتيني", CHRONIC: "مزمن", CHEMICAL: "أورام" };

type Search = { q?: string; view?: string; category?: string; company?: string; from?: string; to?: string; page?: string };

/** حركات الصيدلية: كل صرف بتفاصيله، مع الإلغاء وإعادة الصرف. المرفق يرى صرفه فقط، والإدارة ترى ضمن نطاق شركاتها. */
export default async function PharmacyTransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) redirect("/dashboard");
  const params = await searchParams;
  const staff = canAccessAdmin(session);
  const allowedCompanyIds = await getAllowedCompanyIds(session);
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.PharmacyDispenseWhereInput = {
    company_id: params.company && allowedCompanyIds.includes(params.company) ? params.company : { in: allowedCompanyIds },
    ...(staff ? {} : { facility_id: session.id }),
  };
  // الحذف ناعم: المحذوفة (الملغاة) في تبويب مستقل منه تُستعاد أو تُحذف نهائيًا، كما في الخدمات الأخرى.
  const deletedView = params.view === "deleted";
  const ACTIVE: Prisma.PharmacyDispenseWhereInput = { status: "COMPLETED", transaction: { is_cancelled: false } };
  const DELETED: Prisma.PharmacyDispenseWhereInput = { OR: [{ status: "CANCELLED" }, { transaction: { is_cancelled: true } }] };
  const baseWhere = { ...where };
  const and: Prisma.PharmacyDispenseWhereInput[] = [deletedView ? DELETED : ACTIVE];
  if (params.category && params.category in CATEGORIES) and.push({ medicine_category: params.category as MedicineCategory });
  const query = params.q?.trim().slice(0, 100) ?? "";
  if (query) {
    and.push({ OR: getArabicSearchTerms(query).flatMap((term) => [{ beneficiary: { name: { contains: term, mode: "insensitive" as const } } }, { beneficiary: { card_number: { contains: term, mode: "insensitive" as const } } }]) });
  }
  if (params.from || params.to) {
    and.push({ created_at: { ...(params.from ? { gte: getStartOfDayTripoli(params.from) } : {}), ...(params.to ? { lte: getEndOfDayTripoli(params.to) } : {}) } });
  }
  if (and.length > 0) where.AND = and;

  const [total, deletedCount, sums, rows, companies] = await Promise.all([
    prisma.pharmacyDispense.count({ where }),
    prisma.pharmacyDispense.count({ where: { AND: [baseWhere, DELETED] } }),
    prisma.pharmacyDispense.aggregate({ where, _sum: { gross_total: true, company_total: true, patient_total: true } }),
    prisma.pharmacyDispense.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, medicine_category: true, gross_total: true, company_total: true, patient_total: true, status: true, created_at: true,
        cancelled_at: true, cancellation_reason: true, facility_id: true, company_id: true, beneficiary_id: true,
        beneficiary: { select: { name: true, card_number: true } },
        company: { select: { name: true } },
        facility: { select: { name: true } },
        transaction: { select: { is_cancelled: true } },
        prescription: { select: { prescription_number: true, attachments: { select: { id: true, kind: true } } } },
        attachments: { select: { id: true, kind: true } },
        items: { orderBy: { sequence: "asc" }, select: { sequence: true, price: true, company_share: true, patient_share: true, drug: { select: { name: true } } } },
      },
    }),
    prisma.insuranceCompany.findMany({ where: { id: { in: allowedCompanyIds } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const selectedCompany = params.company ? companies.find((company) => company.id === params.company) ?? null : null;
  const today = getTripoliDayWindow(new Date());
  const canCancelAny = hasPermission(session, "cancel_transactions");
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const viewHref = (deleted: boolean) => {
    const next = new URLSearchParams(Object.entries(params).filter(([key, value]) => value && key !== "page" && key !== "view") as Array<[string, string]>);
    if (deleted) next.set("view", "deleted");
    return `/admin/pharmacy-services/transactions?${next}`;
  };
  const hrefFor = (next: number) => `/admin/pharmacy-services/transactions?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, value]) => value)), page: String(next) })}`;
  const money = (value: unknown) => `${Number(value ?? 0).toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} د.ل`;
  const field = "h-10 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900";

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-4 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white"><Receipt className="h-6 w-6 text-teal-600" /> حركات الصيدلية{selectedCompany ? ` — ${selectedCompany.name}` : ""}</h1>
          <Link href={selectedCompany ? `/admin/pharmacy-services/${selectedCompany.id}` : "/admin/pharmacy-services"} className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-teal-700"><ArrowRight className="h-4 w-4" /> {selectedCompany ? `صرف الأدوية — ${selectedCompany.name}` : "خدمات الصيدلية"}</Link>
        </div>

        <Card className="p-3">
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-bold text-slate-500">بحث<input name="q" defaultValue={query} placeholder="الاسم أو رقم البطاقة" className={field} /></label>
            {deletedView && <input type="hidden" name="view" value="deleted" />}
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">النوع
              <select name="category" defaultValue={params.category ?? ""} className={field}><option value="">الكل</option>{Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
            {(
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">الشركة
                <select name="company" defaultValue={params.company ?? ""} className={field}><option value="">كل الشركات</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">من<input type="date" name="from" defaultValue={params.from ?? ""} className={field} dir="ltr" /></label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-500">إلى<input type="date" name="to" defaultValue={params.to ?? ""} className={field} dir="ltr" /></label>
            <button type="submit" className="h-10 rounded-md bg-teal-600 px-4 text-sm font-bold text-white">عرض</button>
          </form>
        </Card>

        <div className="grid gap-2 sm:grid-cols-4">
          {[[deletedView ? "عدد المحذوفة" : "عدد الحركات", total.toLocaleString("ar-LY")], ["الإجمالي", money(sums._sum.gross_total)], ["على الشركات", money(sums._sum.company_total)], ["على المستفيدين", money(sums._sum.patient_total)]].map(([label, value]) => (
            <Card key={label} className="p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="text-lg font-black tabular-nums">{value}</p></Card>
          ))}
        </div>

        <div className="flex gap-2">
          <Link href={viewHref(false)} className={`inline-flex h-9 items-center rounded-md border px-4 text-sm font-bold ${!deletedView ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"}`}>الحركات</Link>
          <Link href={viewHref(true)} className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-bold ${deletedView ? "border-rose-600 bg-rose-600 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"}`}>
            <Trash2 className="h-4 w-4" /> المحذوفة
            {deletedCount > 0 && <span className={`rounded-full px-1.5 text-xs ${deletedView ? "bg-white/25" : "bg-rose-100 text-rose-700"}`}>{deletedCount.toLocaleString("ar-LY")}</span>}
          </Link>
        </div>

        <Card className="overflow-hidden">
          {rows.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">{deletedView ? "لا توجد حركات محذوفة" : "لا توجد حركات مطابقة"}</p> : (
            <DispenseTable
              deletedView={deletedView}
              canRestore={canCancelAny}
              canDeletePermanently={hasPermission(session, "delete_transaction")}
              rows={rows.map((row) => {
                const cancelled = row.status === "CANCELLED" || row.transaction.is_cancelled;
                const ownSameDay = row.facility_id === session.id && row.created_at >= today.start && row.created_at < today.end;
                return {
                      id: row.id,
                      category: CATEGORIES[row.medicine_category],
                      beneficiary: row.beneficiary.name,
                      card: row.beneficiary.card_number,
                      company: row.company.name,
                      facility: row.facility.name,
                      createdAt: row.created_at.toISOString(),
                      cancelledAt: row.cancelled_at?.toISOString() ?? null,
                      fromPrescription: Boolean(row.prescription),
                      gross: Number(row.gross_total),
                      companyShare: Number(row.company_total),
                      patientShare: Number(row.patient_total),
                      cancelled,
                      cancellationReason: row.cancellation_reason ?? (row.transaction.is_cancelled && row.status !== "CANCELLED" ? "أُلغيت الحركة المالية من شاشة الحركات" : null),
                      prescriptionNumber: row.prescription?.prescription_number ?? null,
                      attachments: [...row.attachments, ...(row.prescription?.attachments ?? [])],
                      items: row.items.map((item) => ({ label: item.drug?.name ?? `البند ${item.sequence}`, price: Number(item.price), company: Number(item.company_share), patient: Number(item.patient_share) })),
                      // الصيدلية تحذف صرفها في يومه فقط؛ بعده يُحذف من الإدارة (حتى لا تُحذف حركات قديمة دون رقابة).
                      canCancel: !cancelled && hasPermission(session, "pharmacy_services") && (canCancelAny || ownSameDay),
                };
              })}
            />
          )}
        </Card>
        <div className="flex justify-center"><PaginationButtons page={page} totalPages={totalPages} hrefForPage={hrefFor} /></div>
      </div>
    </Shell>
  );
}
