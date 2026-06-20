import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Shell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";
import Link from "next/link";
import {
  Stethoscope, Building2, Search, Download, ChevronRight, ChevronLeft,
  TrendingDown, Users, ShieldCheck, Calendar, FileSpreadsheet
} from "lucide-react";
import { OpticsExportButton } from "@/components/optics-export-button";

const PAGE_SIZE = 30;

type OpticsTx = {
  id: string;
  amount: Prisma.Decimal;
  actual_company_share: Prisma.Decimal | null;
  actual_patient_share: Prisma.Decimal | null;
  remaining_ceiling_after: Prisma.Decimal | null;
  created_at: Date;
  is_cancelled: boolean;
  type: string;
  beneficiary: { id: string; name: string; card_number: string } | null;
  facility: { id: string; name: string } | null;
  company: { id: string; name: string; code: string } | null;
};

export default async function OpticsTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    company?: string;
    facility?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin && !session.is_manager) redirect("/dashboard");

  const sp = await searchParams;
  const searchQuery = (sp.q ?? "").trim();
  const companyFilter = sp.company ?? "all";
  const facilityFilter = sp.facility ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const fromDate = sp.from ?? "";
  const toDate = sp.to ?? "";

  // جلب قائمة الشركات للفلتر
  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  // جلب قائمة المرافق للفلتر (المشرف يرى الكل، غير ذلك يرى مرفقه فقط)
  const facilities = session.is_admin
    ? await prisma.facility.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [{ id: session.id, name: session.name }];

  const selectedFacility = facilities.find((f) => f.id === facilityFilter || f.name === facilityFilter);
  const resolvedFacilityId = session.is_admin ? selectedFacility?.id : session.id;
  const facilityFilterInputValue = session.is_admin
    ? (selectedFacility?.name ?? facilityFilter)
    : session.name;

  // بناء شروط الاستعلام
  const where: Prisma.TransactionWhereInput = {
    type: "OPTICS",
    is_cancelled: false,
  };

  if (companyFilter !== "all") {
    where.company_id = companyFilter;
  }

  if (resolvedFacilityId) {
    where.facility_id = resolvedFacilityId;
  }

  if (fromDate) {
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    where.created_at = { ...(where.created_at as object ?? {}), gte: from };
  }
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    where.created_at = { ...(where.created_at as object ?? {}), lte: to };
  }

  if (searchQuery) {
    where.OR = [
      { beneficiary: { name: { contains: searchQuery, mode: "insensitive" } } },
      { beneficiary: { card_number: { contains: searchQuery, mode: "insensitive" } } },
    ];
  }

  const [total, transactions, stats] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        amount: true,
        actual_company_share: true,
        actual_patient_share: true,
        remaining_ceiling_after: true,
        created_at: true,
        is_cancelled: true,
        type: true,
        beneficiary: { select: { id: true, name: true, card_number: true } },
        facility: { select: { id: true, name: true } },
        company: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.transaction.aggregate({
      where,
      _sum: { amount: true, actual_company_share: true, actual_patient_share: true },
      _count: true,
    }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const totalAmount = Number(stats._sum.amount ?? 0);
  const totalCompanyShare = Number(stats._sum.actual_company_share ?? 0);
  const totalPatientShare = Number(stats._sum.actual_patient_share ?? 0);

  const COMPANY_BADGE_COLORS: Record<string, string> = {
    0: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
    1: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
    2: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
    3: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    4: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    5: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  };
  const companyColorMap = new Map(
    companies.map((c, i) => [c.id, COMPANY_BADGE_COLORS[i % 6]])
  );

  const selectedCompanyName = companyFilter !== "all"
    ? companies.find(c => c.id === companyFilter)?.name
    : null;

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        {/* العنوان */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400">
                <Stethoscope className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white">حركات البصريات</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              سجل مستقل لجميع عمليات خصم خدمات البصريات — مفصول عن الحركات العامة
            </p>
          </div>
          <div className="flex items-center gap-3">
            {session.is_admin && (
              <Link href="/admin/optics-transactions/import">
                <button className="inline-flex items-center justify-center rounded-md font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 h-10 px-4 py-2 text-sm gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span>استيراد حركات البصريات</span>
                </button>
              </Link>
            )}
            <OpticsExportButton
              companyId={companyFilter !== "all" ? companyFilter : undefined}
              companyName={selectedCompanyName ?? undefined}
              searchQuery={searchQuery}
              fromDate={fromDate}
              toDate={toDate}
            />
          </div>
        </div>

        {/* إحصائيات */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card className="p-4 border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/10">
            <p className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-500">إجمالي الحركات</p>
            <p className="mt-1 text-2xl font-black text-teal-800 dark:text-teal-300">{total.toLocaleString("ar-LY")}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">إجمالي الفواتير</p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{totalAmount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-slate-400">د.ل</p>
          </Card>
          <Card className="p-4 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
            <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-500">على شركات التأمين</p>
            <p className="mt-1 text-2xl font-black text-blue-800 dark:text-blue-300">{totalCompanyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-blue-400">د.ل</p>
          </Card>
          <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
            <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-500">على المؤمنين (كاش)</p>
            <p className="mt-1 text-2xl font-black text-amber-800 dark:text-amber-300">{totalPatientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-amber-400">د.ل</p>
          </Card>
        </div>

        {/* فلاتر */}
        <Card className="p-4">
          <form method="GET" className="flex flex-wrap gap-3">
            {/* بحث */}
            <div className="relative flex-1 min-w-52">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                name="q"
                defaultValue={searchQuery}
                placeholder="ابحث بالاسم أو رقم البطاقة..."
                className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pr-9 pl-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
              />
            </div>

            {/* فلتر الشركة */}
            <div className="relative min-w-48">
              <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <select
                name="company"
                defaultValue={companyFilter}
                className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pr-9 pl-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
              >
                <option value="all">جميع الشركات</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* فلتر المرفق للمشرفين */}
            {session.is_admin && (
              <div className="relative min-w-48">
                <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  name="facility"
                  defaultValue={facilityFilterInputValue}
                  placeholder="كل المرافق"
                  list="facilities-list-optics"
                  className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pr-9 pl-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                />
                <datalist id="facilities-list-optics">
                  {facilities.map((f: { id: string; name: string }) => (
                    <option key={f.id} value={f.name} />
                  ))}
                </datalist>
              </div>
            )}

            {/* نطاق التاريخ */}
            <div className="flex items-center gap-1">
              <input
                type="date" lang="en-GB"
                name="from"
                defaultValue={fromDate}
                className="flex h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
              />
              <span className="text-slate-400 font-bold text-xs">—</span>
              <input
                type="date" lang="en-GB"
                name="to"
                defaultValue={toDate}
                className="flex h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
              />
            </div>

            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md bg-teal-600 hover:bg-teal-700 px-4 text-sm font-black text-white transition-colors"
            >
              تطبيق
            </button>
            <Link
              href="/admin/optics-transactions"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              إعادة تعيين
            </Link>
          </form>
        </Card>

        {/* الجدول */}
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">المستفيد</th>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">الشركة</th>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">قيمة الفاتورة</th>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">حصة الشركة</th>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">حصة المؤمن</th>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">المتبقي بالسقف</th>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">المرفق</th>
                  <th className="px-4 py-3.5 text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400 font-bold">
                      لا توجد حركات بصريات بالمعايير المحددة
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const amount = Number(tx.amount);
                    const companyShare = tx.actual_company_share !== null ? Number(tx.actual_company_share) : null;
                    const patientShare = tx.actual_patient_share !== null ? Number(tx.actual_patient_share) : null;
                    const remaining = tx.remaining_ceiling_after !== null ? Number(tx.remaining_ceiling_after) : null;
                    const colorClass = tx.company ? (companyColorMap.get(tx.company.id) ?? "bg-slate-100 text-slate-700") : "bg-slate-100 text-slate-700";

                    return (
                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3.5">
                          <div>
                            <p className="font-black text-slate-900 dark:text-white text-sm">{tx.beneficiary?.name ?? "—"}</p>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{tx.beneficiary?.card_number ?? "—"}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {tx.company ? (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${colorClass}`}>
                              {tx.company.name}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className="font-mono font-black text-slate-900 dark:text-white text-sm">
                            {amount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}
                          </span>
                          <span className="text-[10px] text-slate-400 mr-1">د.ل</span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {companyShare !== null ? (
                            <span className="font-mono font-black text-blue-700 dark:text-blue-400 text-sm">
                              {companyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {patientShare !== null ? (
                            <span className="font-mono font-black text-amber-700 dark:text-amber-400 text-sm">
                              {patientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {remaining !== null ? (
                            <span className={`font-mono font-black text-sm ${remaining < 200 ? "text-red-600 dark:text-red-400" : remaining < 500 ? "text-amber-600 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                              {remaining.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">مفتوح</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{tx.facility?.name ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div>
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{formatDateTripoli(tx.created_at)}</p>
                            <p className="text-[10px] text-slate-400">{formatTimeTripoli(tx.created_at)}</p>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* الترقيم */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 px-4 py-3">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {total.toLocaleString("ar-LY")} حركة • الصفحة {page} من {totalPages}
              </p>
              <div className="flex items-center gap-1">
                {page > 1 && (
                  <Link
                    href={`/admin/optics-transactions?${new URLSearchParams({ ...sp, page: String(page - 1) }).toString()}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/admin/optics-transactions?${new URLSearchParams({ ...sp, page: String(page + 1) }).toString()}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
