import Link from "next/link";
import { Building2, Search, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import prisma from "@/lib/prisma";
import type { Session } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/permissions";
import { getAllowedCompanyIds } from "@/lib/company-scope";
import { hasPermission } from "@/lib/session-guard";
import { getTripoliDayWindow } from "@/lib/pharmacy/policy";
import { buildDispenseWhere, DELETED_DISPENSE_WHERE, DISPENSE_CATEGORIES, dispenseFilterQuery, type DispenseFilterParams } from "@/lib/pharmacy/dispense-filter";
import { DispenseTable } from "@/app/admin/pharmacy-services/transactions/dispense-table";

const PAGE_SIZE = 25;
const FIELD = "flex h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30";

/**
 * حركات الصيدلية بنفس هيكل «آخر الحركات» في الخدمات الأخرى: بطاقات الملخص، شريط الفلترة،
 * وبطاقة «سجل الحركات» بالجدول والإجراءات الجماعية والطباعة والتصدير.
 * basePath: الصفحة التي يُعرض فيها القسم (تبويب الشركة أو صفحة كل الشركات)، وhidden: حقول ثابتة فيها.
 */
export async function PharmacyTransactionsSection({ session, params, basePath, hidden, companies }: {
  session: Session;
  params: DispenseFilterParams;
  basePath: string;
  hidden: Record<string, string>;
  /** قائمة الشركات لفلتر الشركة (صفحة كل الشركات فقط). */
  companies?: Array<{ id: string; name: string }>;
}) {
  const staff = canAccessAdmin(session);
  const allowedCompanyIds = await getAllowedCompanyIds(session);
  const { filtered, deletedView, where } = buildDispenseWhere(params, { allowedCompanyIds, facilityId: staff ? null : session.id });
  const page = Math.max(1, Number(params.page) || 1);

  const [total, deletedCount, sums, rows, facilities] = await Promise.all([
    prisma.pharmacyDispense.count({ where }),
    prisma.pharmacyDispense.count({ where: { AND: [filtered, DELETED_DISPENSE_WHERE] } }),
    prisma.pharmacyDispense.aggregate({ where, _sum: { gross_total: true, company_total: true, patient_total: true } }),
    prisma.pharmacyDispense.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, medicine_category: true, gross_total: true, company_total: true, patient_total: true, status: true, created_at: true,
        cancelled_at: true, cancellation_reason: true, facility_id: true,
        beneficiary: { select: { name: true, card_number: true } },
        company: { select: { name: true } },
        facility: { select: { name: true } },
        transaction: { select: { is_cancelled: true } },
        prescription: { select: { prescription_number: true, attachments: { select: { id: true, kind: true } } } },
        attachments: { select: { id: true, kind: true } },
        items: { orderBy: { sequence: "asc" }, select: { sequence: true, price: true, company_share: true, patient_share: true, drug: { select: { name: true } } } },
      },
    }),
    staff ? prisma.facility.findMany({ where: { deleted_at: null, pharmacy_dispenses: { some: {} } }, select: { name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  const today = getTripoliDayWindow(new Date());
  const canCancelAny = hasPermission(session, "cancel_transactions");
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (extra: Record<string, string | undefined>) => {
    const next = new URLSearchParams({ ...hidden });
    for (const [key, value] of Object.entries({ ...params, ...extra })) if (value && !(key in hidden)) next.set(key, value);
    return `${basePath}?${next}`;
  };
  const filterQuery = dispenseFilterQuery({ ...params, ...(hidden.company ? { company: hidden.company } : {}) });
  const amount = (value: unknown) => Number(value ?? 0).toLocaleString("ar-LY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Card className="p-4 border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/10">
          <p className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-500">{deletedView ? "الحركات المحذوفة" : "إجمالي الحركات"}</p>
          <p className="mt-1 text-2xl font-black text-teal-800 dark:text-teal-300">{total.toLocaleString("ar-LY")}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">إجمالي الفواتير</p>
          <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{amount(sums._sum.gross_total)}</p>
          <p className="text-[10px] text-slate-400">د.ل</p>
        </Card>
        <Card className="p-4 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
          <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-500">على الشركة</p>
          <p className="mt-1 text-2xl font-black text-blue-800 dark:text-blue-300">{amount(sums._sum.company_total)}</p>
          <p className="text-[10px] text-blue-400">د.ل</p>
        </Card>
        <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-500">على المؤمنين</p>
          <p className="mt-1 text-2xl font-black text-amber-800 dark:text-amber-300">{amount(sums._sum.patient_total)}</p>
          <p className="text-[10px] text-amber-400">د.ل</p>
        </Card>
      </div>

      <Card className="p-4 overflow-x-auto">
        <form method="GET" action={basePath} className="flex flex-nowrap items-center gap-3 min-w-max">
          {Object.entries(hidden).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
          {deletedView && <input type="hidden" name="view" value="deleted" />}
          <div className="relative min-w-60 flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input type="text" name="q" defaultValue={params.q ?? ""} placeholder="ابحث باسم المستفيد أو رقم البطاقة..." className={`${FIELD} w-full pr-9 pl-3`} />
          </div>
          {staff && (
            <div className="relative w-52 shrink-0">
              <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input type="text" name="facility" defaultValue={params.facility ?? ""} placeholder="كل الصيدليات" list="pharmacy-facilities" autoComplete="off" className={`${FIELD} w-full pr-9 pl-3`} />
              <datalist id="pharmacy-facilities">{facilities.map((facility) => <option key={facility.name} value={facility.name} />)}</datalist>
            </div>
          )}
          {companies && (
            <select name="company" defaultValue={params.company ?? ""} aria-label="الشركة" className={`${FIELD} w-44 shrink-0`}>
              <option value="">كل الشركات</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          )}
          <select name="category" defaultValue={params.category ?? ""} aria-label="نوع الدواء" className={`${FIELD} w-32 shrink-0`}>
            <option value="">كل الأنواع</option>
            {Object.entries(DISPENSE_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-bold text-slate-500">من</span>
            <input type="date" lang="en-GB" name="from" defaultValue={params.from ?? ""} className={FIELD} />
            <span className="text-xs font-bold text-slate-500">إلى</span>
            <input type="date" lang="en-GB" name="to" defaultValue={params.to ?? ""} className={FIELD} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="submit" className="inline-flex h-10 items-center justify-center rounded-md bg-teal-600 hover:bg-teal-700 px-5 text-sm font-black text-white transition-colors cursor-pointer">تطبيق</button>
            <Link href={`${basePath}?${new URLSearchParams(hidden)}`} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">إعادة تعيين</Link>
          </div>
        </form>
      </Card>

      <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-1 w-fit">
        <Link href={link({ view: undefined, page: undefined })} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${!deletedView ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700" : "text-slate-600 dark:text-slate-400 hover:text-slate-900"}`}>السارية</Link>
        <Link href={link({ view: "deleted", page: undefined })} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${deletedView ? "bg-white dark:bg-slate-800 text-rose-700 dark:text-rose-400 shadow-sm border border-slate-200 dark:border-slate-700" : "text-slate-600 dark:text-slate-400 hover:text-slate-900"}`}>
          <Trash2 className="h-3.5 w-3.5" /> المحذوفة
          {deletedCount > 0 && <span className="text-[10px] font-black bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 px-1.5 py-0.5 rounded-full">{deletedCount.toLocaleString("ar-LY")}</span>}
        </Link>
      </div>

      <DispenseTable
        deletedView={deletedView}
        canRestore={canCancelAny}
        canDeletePermanently={hasPermission(session, "delete_transaction")}
        page={page}
        totalPages={totalPages}
        total={total}
        prevHref={page > 1 ? link({ page: String(page - 1) }) : null}
        nextHref={page < totalPages ? link({ page: String(page + 1) }) : null}
        printHref={`/admin/pharmacy-services/transactions/statement?${filterQuery}`}
        exportHref={staff && (session.is_admin || hasPermission(session, "export_data")) ? `/api/pharmacy/transactions-export?${filterQuery}` : null}
        showCompany={Boolean(companies)}
        rows={rows.map((row) => {
          const cancelled = row.status === "CANCELLED" || row.transaction.is_cancelled;
          const ownSameDay = row.facility_id === session.id && row.created_at >= today.start && row.created_at < today.end;
          return {
            id: row.id,
            category: DISPENSE_CATEGORIES[row.medicine_category],
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
            items: row.items.map((item) => ({ sequence: item.sequence, label: item.drug?.name ?? `البند ${item.sequence}`, price: Number(item.price), company: Number(item.company_share), patient: Number(item.patient_share) })),
            // الصيدلية تحذف صرفها في يومه فقط؛ بعده يُحذف من الإدارة (حتى لا تُحذف حركات قديمة دون رقابة).
            canCancel: !cancelled && hasPermission(session, "pharmacy_services") && (canCancelAny || ownSameDay),
          };
        })}
      />
    </div>
  );
}
