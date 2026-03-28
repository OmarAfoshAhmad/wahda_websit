import { redirect } from "next/navigation";
import { Search, Users, CalendarDays, CreditCard, Trash2, RotateCcw, Upload, Download } from "lucide-react";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getArabicSearchTerms } from "@/lib/search";
import { Shell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";
import { BeneficiariesSearch } from "@/components/beneficiaries-search";
import { BeneficiaryEditModal } from "@/components/beneficiary-edit-modal";
import { BeneficiaryCreateModal } from "@/components/beneficiary-create-modal";
import { BeneficiaryDeleteButton } from "@/components/beneficiary-delete-button";
import { BeneficiaryRestoreActions } from "@/components/beneficiary-restore-actions";
import { BeneficiaryResetPinButton } from "@/components/beneficiary-reset-pin-button";

export default async function BeneficiariesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; pageSize?: string; view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const { q, page: pageParam, pageSize: pageSizeParam, view } = await searchParams;
  const query = (q?.trim() ?? "").slice(0, 100);
  const isDeletedView = view === "deleted";
  const allowedPageSizes = [10, 25, 50, 100, 200];
  const requestedPageSize = parseInt(pageSizeParam ?? "10", 10);
  const PAGE_SIZE = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 10;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const baseFilter = isDeletedView
    ? { deleted_at: { not: null } }
    : { deleted_at: null };

  const where = query
    ? {
        ...baseFilter,
        OR: getArabicSearchTerms(query).flatMap(t => [
          { name: { contains: t, mode: "insensitive" as const } },
          { card_number: { contains: t, mode: "insensitive" as const } },
        ]),
      }
    : baseFilter;

  const [rawBeneficiaries, filteredCount, statusCounts] = await Promise.all([
    prisma.beneficiary.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { transactions: true } } },
    }),
    prisma.beneficiary.count({ where }),
    // استعلام واحد بدلاً من 3 استعلامات منفصلة
    prisma.$queryRaw<Array<{ is_deleted: boolean; status: string; _count: bigint }>>`
      SELECT
        ("deleted_at" IS NOT NULL) AS is_deleted,
        status,
        COUNT(*)::bigint AS _count
      FROM "Beneficiary"
      GROUP BY is_deleted, status
    `,
  ]);

  // تحويل Decimal إلى Number لتجنب أخطاء التسلسل
  const beneficiaries = rawBeneficiaries.map((b) => ({
    ...b,
    total_balance: Number(b.total_balance),
    remaining_balance: Number(b.remaining_balance),
  }));

  // حساب الأعداد من نتيجة groupBy
  let totalCount = 0;
  let activeCount = 0;
  let deletedCount = 0;
  for (const row of statusCounts) {
    const cnt = Number(row._count);
    if (row.is_deleted) {
      deletedCount += cnt;
    } else {
      totalCount += cnt;
      if (row.status === "ACTIVE") activeCount = cnt;
    }
  }

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const exportParams = new URLSearchParams();
  if (query) exportParams.set("q", query);
  if (isDeletedView) exportParams.set("view", "deleted");
  const exportHref = `/api/export/beneficiaries?${exportParams.toString()}`;

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
      <div className="space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">المستفيدون</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">نافذة مخصصة لعرض المستفيدين والبحث بالاسم أو رقم البطاقة.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/import"
              className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-800 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Upload className="h-4 w-4" />
              الاستيراد
            </Link>
            <a
              href={exportHref}
              target="_blank"
              className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-600 px-4 text-sm font-black text-white! transition-colors hover:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              <Download className="h-4 w-4" />
              تصدير Excel
            </a>
            <BeneficiaryCreateModal />
            <div className="w-full sm:w-80 lg:w-96">
              <BeneficiariesSearch key={query} initialQuery={query} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">إجمالي المستفيدين</p>
                <p className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">{totalCount}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-primary dark:text-blue-400">
                <Users className="h-5 w-5" />
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">الحالات النشطة</p>
                <p className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">{activeCount}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-emerald-600 dark:text-emerald-400">
                <CreditCard className="h-5 w-5" />
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">نتائج البحث</p>
                <p className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">{filteredCount}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-sky-600 dark:text-sky-400">
                <Search className="h-5 w-5" />
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">المحذوفون</p>
                <p className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-100">{deletedCount}</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-red-500 dark:text-red-400">
                <Trash2 className="h-5 w-5" />
              </div>
            </div>
          </Card>
        </div>

        {/* تبويب عرض النشطين / المحذوفين */}
        <div className="flex gap-2">
          <Link
            href={`/beneficiaries?${new URLSearchParams({ ...(query ? { q: query } : {}) }).toString()}`}
            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-bold transition-colors ${
              !isDeletedView
                ? "border-primary/20 bg-primary-light dark:bg-primary-light/10 text-primary dark:text-blue-400 dark:border-primary/30"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            <Users className="h-4 w-4" />
            النشطون
            <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-xs font-black text-slate-600 dark:text-slate-300">{totalCount}</span>
          </Link>
          <Link
            href={`/beneficiaries?view=deleted${query ? `&q=${encodeURIComponent(query)}` : ""}`}
            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-bold transition-colors ${
              isDeletedView
                ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            <RotateCcw className="h-4 w-4" />
            المحذوفون
            {deletedCount > 0 && (
              <span className="rounded-full bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-xs font-black text-red-600 dark:text-red-400">{deletedCount}</span>
            )}
          </Link>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المستفيد</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">رقم البطاقة</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">تاريخ الميلاد</th>
                  {!isDeletedView && <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">الرصيد المتبقي</th>}
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">الحالة</th>
                  {isDeletedView && <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">تاريخ الحذف</th>}
                  {session.is_admin && (
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">إجراءات</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {beneficiaries.length === 0 ? (
                  <tr>
                    <td colSpan={session.is_admin ? 6 : 5} className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{isDeletedView ? "لا يوجد مستفيدون محذوفون." : "لا توجد نتائج مطابقة."}</td>
                  </tr>
                ) : (
                  beneficiaries.map((beneficiary) => (
                    <tr key={beneficiary.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900 dark:text-white">{beneficiary.name}</p>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">{beneficiary.card_number}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                        <span className="inline-flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                          {beneficiary.birth_date ? new Date(beneficiary.birth_date).toLocaleDateString("ar-LY") : "غير مسجل"}
                        </span>
                      </td>
                      {!isDeletedView && (
                        <td className="px-6 py-4 text-sm font-bold text-slate-900 dark:text-white">{Number(beneficiary.remaining_balance).toLocaleString("ar-LY")} د.ل</td>
                      )}
                      <td className="px-6 py-4">
                        <Badge variant={beneficiary.status === "ACTIVE" ? "success" : beneficiary.status === "SUSPENDED" ? "warning" : "default"}>
                          {beneficiary.status === "ACTIVE" ? "نشط" : beneficiary.status === "SUSPENDED" ? "موقوف" : "مكتمل"}
                        </Badge>
                      </td>
                      {isDeletedView && (
                        <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                          {beneficiary.deleted_at ? new Date(beneficiary.deleted_at).toLocaleDateString("ar-LY") : "—"}
                        </td>
                      )}
                      {session.is_admin && (
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            {isDeletedView ? (
                              <BeneficiaryRestoreActions
                                id={beneficiary.id}
                                name={beneficiary.name}
                                hasTransactions={beneficiary._count.transactions > 0}
                              />
                            ) : (
                              <>
                                {beneficiary.pin_hash && <BeneficiaryResetPinButton beneficiaryId={beneficiary.id} />}
                                <BeneficiaryEditModal
                                  beneficiary={{
                                    id: beneficiary.id,
                                    name: beneficiary.name,
                                    card_number: beneficiary.card_number,
                                    birth_date: beneficiary.birth_date ? new Date(beneficiary.birth_date).toISOString().slice(0, 10) : "",
                                    status: beneficiary.status,
                                  }}
                                />
                                <BeneficiaryDeleteButton
                                  id={beneficiary.id}
                                  name={beneficiary.name}
                                  hasTransactions={beneficiary._count.transactions > 0}
                                />
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6 bg-white dark:bg-slate-900">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                صفحة <strong className="text-slate-900 dark:text-white">{page}</strong> من <strong className="text-slate-900 dark:text-white">{totalPages}</strong>
              </p>
              <form className="flex items-center gap-2">
                <input type="hidden" name="q" value={query} />
                <input type="hidden" name="page" value="1" />
                {isDeletedView && <input type="hidden" name="view" value="deleted" />}
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400">عدد السجلات</label>
                <select
                  name="pageSize"
                  defaultValue={String(PAGE_SIZE)}
                  className="h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-sm text-slate-900 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {allowedPageSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="inline-flex h-8 items-center rounded-md border border-slate-200 dark:border-slate-700 px-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  تطبيق
                </button>
              </form>
            </div>

            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={`/beneficiaries?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(isDeletedView ? { view: "deleted" } : {}), page: String(page - 1), pageSize: String(PAGE_SIZE) }).toString()}`}
                  className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  السابق
                </Link>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
                  السابق
                </span>
              )}

              {page < totalPages ? (
                <Link
                  href={`/beneficiaries?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(isDeletedView ? { view: "deleted" } : {}), page: String(page + 1), pageSize: String(PAGE_SIZE) }).toString()}`}
                  className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  التالي
                </Link>
              ) : (
                <span className="inline-flex cursor-not-allowed items-center rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
                  التالي
                </span>
              )}
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}