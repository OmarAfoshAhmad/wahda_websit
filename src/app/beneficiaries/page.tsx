import { redirect } from "next/navigation";
import { Search, Users, CalendarDays, CreditCard, Trash2, RotateCcw, Upload, Download, GitMerge } from "lucide-react";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getLedgerRemainingByBeneficiaryIds } from "@/lib/ledger-balance";
import { canAccessAdmin, hasPermission } from "@/lib/session-guard";
import { getArabicSearchTerms } from "@/lib/search";
import { formatDateTripoli } from "@/lib/datetime";
import { Shell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";
import { BeneficiariesSearch } from "@/components/beneficiaries-search";
import { BeneficiaryEditModal } from "@/components/beneficiary-edit-modal";
import { BeneficiaryCreateModal } from "@/components/beneficiary-create-modal";
import { BeneficiaryDeleteButton } from "@/components/beneficiary-delete-button";
import { BeneficiaryRestoreActions } from "@/components/beneficiary-restore-actions";
import { BeneficiaryResetPinButton } from "@/components/beneficiary-reset-pin-button";
import { BeneficiaryMergeDuplicatesButton } from "@/components/beneficiary-merge-duplicates-button";
import { PaginationButtons } from "@/components/pagination-buttons";
import { BeneficiariesBulkActionButton, SelectAllCheckbox, EmptyRecycleBinButton } from "@/components/beneficiaries-bulk-action-button";
import { BulkRenewalButton } from "@/components/bulk-renewal-button";
import { unstable_cache } from "next/cache";

function normalizeCardKey(value: string) {
  return value.trim().toUpperCase();
}

// كاش إحصائيات أعداد المستفيدين — يُبطَل فور أي تغيير عبر revalidateTag("beneficiary-counts")
const getCachedStatusCounts = unstable_cache(
  async () => {
    const rows = await prisma.$queryRaw<Array<{ is_deleted: boolean; status: string; _count: bigint }>>`
      SELECT
        ("deleted_at" IS NOT NULL) AS is_deleted,
        status,
        COUNT(*)::bigint AS _count
      FROM "Beneficiary"
      GROUP BY is_deleted, status
    `;
    // تحويل BigInt إلى number لأن unstable_cache يستخدم JSON.stringify
    return rows.map((r) => ({ ...r, _count: Number(r._count) }));
  },
  ["beneficiary-status-counts-v2"],
  { revalidate: 30, tags: ["beneficiary-counts"] }
);

export default async function BeneficiariesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; pageSize?: string; view?: string; sort?: string; order?: string; status?: string; completed_via?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canAccessAdmin(session)) redirect("/dashboard");

  const { q, page: pageParam, pageSize: pageSizeParam, view, sort, order, status, completed_via: completedViaParam } = await searchParams;
  const query = (q?.trim() ?? "").slice(0, 100);
  const isDeletedView = view === "deleted";

  const ALLOWED_STATUS_FILTER = ["all", "ACTIVE", "SUSPENDED", "FINISHED"] as const;
  type StatusFilter = typeof ALLOWED_STATUS_FILTER[number];
  const statusFilter: StatusFilter = (ALLOWED_STATUS_FILTER as ReadonlyArray<string>).includes(status ?? "") ? status as StatusFilter : "all";

  const ALLOWED_COMPLETED_VIA = ["all", "MANUAL", "IMPORT"] as const;
  type CompletedViaFilter = typeof ALLOWED_COMPLETED_VIA[number];
  const completedViaFilter: CompletedViaFilter = (ALLOWED_COMPLETED_VIA as ReadonlyArray<string>).includes(completedViaParam ?? "") ? completedViaParam as CompletedViaFilter : "all";
  const allowedPageSizes = [10, 25, 50, 100, 200];
  const requestedPageSize = parseInt(pageSizeParam ?? "10", 10);
  const PAGE_SIZE = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 10;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const ALLOWED_SORT = ["name", "card_number", "remaining_balance", "status", "created_at"] as const;
  type SortCol = typeof ALLOWED_SORT[number];
  const sortCol: SortCol = (ALLOWED_SORT as ReadonlyArray<string>).includes(sort ?? "") ? sort as SortCol : "created_at";
  const sortDir: "asc" | "desc" = order === "asc" ? "asc" : "desc";

  const buildBeneficiaryParams = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (isDeletedView) p.set("view", "deleted");
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (completedViaFilter !== "all") p.set("completed_via", completedViaFilter);
    p.set("pageSize", String(PAGE_SIZE));
    p.set("sort", sortCol);
    p.set("order", sortDir);
    p.set("page", "1");
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) p.delete(k); else p.set(k, v);
    }
    return `/beneficiaries?${p.toString()}`;
  };

  const sortHref = (col: string) => buildBeneficiaryParams({
    sort: col,
    order: sortCol === col && sortDir === "asc" ? "desc" : "asc",
  });

  const pageHref = (p: number) => buildBeneficiaryParams({ page: String(p) });

  const baseFilter: Record<string, unknown> = isDeletedView
    ? { deleted_at: { not: null } }
    : { deleted_at: null };

  if (statusFilter !== "all" && !isDeletedView) {
    baseFilter.status = statusFilter;
  }

  if (completedViaFilter !== "all" && !isDeletedView) {
    baseFilter.completed_via = completedViaFilter;
  }

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      orderBy: { [sortCol]: sortDir },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { transactions: true } } },
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.beneficiary.count({ where: where as any }),
    getCachedStatusCounts(),
  ]);

  const beneficiaryIds = rawBeneficiaries.map((b) => b.id);
  const remainingById = await getLedgerRemainingByBeneficiaryIds(beneficiaryIds);

  // تحويل Decimal إلى Number لتجنب أخطاء التسلسل
  const beneficiaries = rawBeneficiaries.map((b) => ({
    ...b,
    total_balance: Number(b.total_balance),
    remaining_balance: remainingById.get(b.id) ?? 0,
    completed_via: (b as unknown as Record<string, unknown>).completed_via as string | null,
  }));

  const duplicateCardCount = beneficiaries.reduce<Record<string, number>>((acc, b) => {
    const key = normalizeCardKey(b.card_number);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

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

  const canManageRecycleBin = hasPermission(session, "manage_recycle_bin");
  const canEdit = hasPermission(session, "edit_beneficiary");
  const canDelete = hasPermission(session, "delete_beneficiary");
  const canAdd = hasPermission(session, "add_beneficiary");
  const canImport = hasPermission(session, "import_beneficiaries");
  const canExport = hasPermission(session, "export_data");

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const emptyColSpan = (canEdit || canDelete || session.is_admin) ? 8 : 6;
  const exportParams = new URLSearchParams();
  if (query) exportParams.set("q", query);
  if (isDeletedView) exportParams.set("view", "deleted");
  if (statusFilter !== "all") exportParams.set("status", statusFilter);
  if (completedViaFilter !== "all") exportParams.set("completed_via", completedViaFilter);
  const exportHref = `/api/export/beneficiaries?${exportParams.toString()}`;

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">المستفيدون</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">نافذة مخصصة لعرض المستفيدين والبحث بالاسم أو رقم البطاقة.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {session.is_admin && (
              <Link
                href="/admin/duplicates"
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-800 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <GitMerge className="h-4 w-4" />
                إدارة التكرارات
              </Link>
            )}
            {canImport && (
              <Link
                href="/import"
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-800 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Upload className="h-4 w-4" />
                الاستيراد
              </Link>
            )}
            {canExport && (
              <a
                href={exportHref}
                target="_blank"
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-600 px-4 text-sm font-black text-white! transition-colors hover:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                <Download className="h-4 w-4" />
                تصدير Excel
              </a>
            )}
            {canAdd && <BeneficiaryCreateModal />}
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
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/beneficiaries?${new URLSearchParams({ ...(query ? { q: query } : {}) }).toString()}`}
            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-bold transition-colors ${!isDeletedView
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
            className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-bold transition-colors ${isDeletedView
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

          {/* فلتر الحالة — يظهر فقط في عرض النشطين */}
          {!isDeletedView && (
            <>
              <span className="self-center w-px h-5 bg-slate-200 dark:bg-slate-700" />
              {([
                { value: "all", label: "كل الحالات", activeClass: "border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200" },
                { value: "ACTIVE", label: "نشط", activeClass: "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" },
                { value: "SUSPENDED", label: "موقوف", activeClass: "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" },
                { value: "FINISHED", label: "مكتمل", activeClass: "border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300" },
              ] as const).map(({ value, label, activeClass }) => {
                const isActive = statusFilter === value;
                const href = buildBeneficiaryParams({ status: value === "all" ? undefined : value, page: "1" });
                return (
                  <Link
                    key={value}
                    href={href}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-bold transition-colors ${isActive
                      ? activeClass
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </>
          )}
          {/* فلتر طريقة الاكتمال — يظهر فقط في عرض النشطين */}
          {!isDeletedView && (
            <>
              <span className="self-center w-px h-5 bg-slate-200 dark:bg-slate-700" />
              {([
                { value: "all", label: "كل الاكتمال", activeClass: "border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200" },
                { value: "MANUAL", label: "اكتمال يدوي", activeClass: "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400" },
                { value: "IMPORT", label: "اكتمال بالاستيراد", activeClass: "border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400" },
              ] as const).map(({ value, label, activeClass }) => {
                const isActive = completedViaFilter === value;
                const href = buildBeneficiaryParams({
                  completed_via: value === "all" ? undefined : value,
                  status: value === "all" ? undefined : "FINISHED",
                  page: "1",
                });
                return (
                  <Link
                    key={`cv-${value}`}
                    href={href}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-bold transition-colors ${isActive
                      ? activeClass
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </>
          )}

        </div>
        <Card className="overflow-hidden">
          <form id="beneficiaries-bulk-form">
            {(session.is_admin || (canDelete && !isDeletedView) || (canManageRecycleBin && isDeletedView)) && (
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3 sm:px-6">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                  {statusFilter === "FINISHED" && !isDeletedView
                    ? "حدد المستفيدين المكتملين ثم اضغط تجديد الرصيد لإعادة تفعيلهم."
                    : isDeletedView
                    ? "يمكنك تحديد أكثر من مستفيد محذوف ثم تنفيذ الحذف النهائي الجماعي للسجلات القابلة."
                    : "يمكنك تحديد أكثر من مستفيد ثم تنفيذ الحذف الناعم الجماعي."}
                </p>
                <div className="flex items-center gap-2">
                  {statusFilter === "FINISHED" && !isDeletedView && session.is_admin && <BulkRenewalButton formId="beneficiaries-bulk-form" />}
                  {isDeletedView && canManageRecycleBin && <EmptyRecycleBinButton disabled={deletedCount === 0} />}
                  <BeneficiariesBulkActionButton formId="beneficiaries-bulk-form" mode={isDeletedView ? "permanent" : "soft"} />
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    {(session.is_admin || (canDelete && !isDeletedView) || (canManageRecycleBin && isDeletedView)) && (
                      <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                        <div className="flex items-center gap-2">
                          <SelectAllCheckbox formId="beneficiaries-bulk-form" />
                          <span>تحديد</span>
                        </div>
                      </th>
                    )}
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                      <Link href={sortHref("name")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        المستفيد {sortCol === "name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                    </th>
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                      <Link href={sortHref("card_number")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        رقم البطاقة {sortCol === "card_number" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                    </th>
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">تاريخ الميلاد</th>
                    {!isDeletedView && (
                      <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                        <Link href={sortHref("remaining_balance")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                          الرصيد المتبقي {sortCol === "remaining_balance" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                        </Link>
                      </th>
                    )}
                    <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                      <Link href={sortHref("status")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        الحالة {sortCol === "status" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                    </th>
                    {!isDeletedView && <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">طريقة الاكتمال</th>}
                    {isDeletedView && <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">تاريخ الحذف</th>}
                    {(canEdit || canDelete || canManageRecycleBin || session.is_admin) && (
                      <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">إجراءات</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {beneficiaries.length === 0 ? (
                    <tr>
                      <td colSpan={emptyColSpan} className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{isDeletedView ? "لا يوجد مستفيدون محذوفون." : "لا توجد نتائج مطابقة."}</td>
                    </tr>
                  ) : (
                    beneficiaries.map((beneficiary) => (
                      <tr key={beneficiary.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        {(session.is_admin || (canDelete && !isDeletedView) || (canManageRecycleBin && isDeletedView)) && (
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              name="ids"
                              value={beneficiary.id}
                              disabled={statusFilter !== "FINISHED" && beneficiary._count.transactions > 0}
                              title={statusFilter !== "FINISHED" && beneficiary._count.transactions > 0 ? "لا يمكن تنفيذ هذا الإجراء على مستفيد لديه حركات مالية" : "تحديد المستفيد"}
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                        )}
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-900 dark:text-white">{beneficiary.name}</p>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">{beneficiary.card_number}</td>
                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                          <span className="inline-flex items-center gap-2">
                            <CalendarDays className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                            {beneficiary.birth_date ? formatDateTripoli(beneficiary.birth_date, "en-GB") : "غير مسجل"}
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
                        {!isDeletedView && (
                          <td className="px-6 py-4">
                            {beneficiary.status === "FINISHED" ? (
                              beneficiary.completed_via === "IMPORT" ? (
                                <span className="inline-flex items-center rounded-md border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/30 px-2 py-1 text-xs font-bold text-violet-700 dark:text-violet-400">استيراد</span>
                              ) : beneficiary.completed_via === "MANUAL" ? (
                                <span className="inline-flex items-center rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 text-xs font-bold text-blue-700 dark:text-blue-400">يدوي</span>
                              ) : (
                                <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                              )
                            ) : (
                              <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>
                        )}
                        {isDeletedView && (
                          <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">
                            {beneficiary.deleted_at ? formatDateTripoli(beneficiary.deleted_at, "en-GB") : "—"}
                          </td>
                        )}
                        {(canEdit || canDelete || canManageRecycleBin || session.is_admin) && (
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5">
                              {isDeletedView ? (
                                canManageRecycleBin && (
                                  <BeneficiaryRestoreActions
                                    id={beneficiary.id}
                                    name={beneficiary.name}
                                    hasTransactions={beneficiary._count.transactions > 0}
                                  />
                                )
                              ) : (
                                <>
                                  {canEdit && beneficiary.pin_hash && <BeneficiaryResetPinButton beneficiaryId={beneficiary.id} />}
                                  {canEdit && duplicateCardCount[normalizeCardKey(beneficiary.card_number)] > 1 && (
                                    <BeneficiaryMergeDuplicatesButton
                                      beneficiaryId={beneficiary.id}
                                      beneficiaryName={beneficiary.name}
                                      cardNumber={beneficiary.card_number}
                                    />
                                  )}
                                  {canEdit && (
                                    <BeneficiaryEditModal
                                      beneficiary={{
                                        id: beneficiary.id,
                                        name: beneficiary.name,
                                        card_number: beneficiary.card_number,
                                        birth_date: beneficiary.birth_date ? new Date(beneficiary.birth_date).toISOString().slice(0, 10) : "",
                                        status: beneficiary.status,
                                      }}
                                    />
                                  )}
                                  {canDelete && (
                                    <BeneficiaryDeleteButton
                                      id={beneficiary.id}
                                      name={beneficiary.name}
                                      hasTransactions={beneficiary._count.transactions > 0}
                                    />
                                  )}
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
          </form>

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6 bg-white dark:bg-slate-900">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                صفحة <strong className="text-slate-900 dark:text-white">{page}</strong> من <strong className="text-slate-900 dark:text-white">{totalPages}</strong>
              </p>
              <form className="flex items-center gap-2">
                <input type="hidden" name="q" value={query} />
                <input type="hidden" name="page" value="1" />
                {isDeletedView && <input type="hidden" name="view" value="deleted" />}
                {statusFilter !== "all" && <input type="hidden" name="status" value={statusFilter} />}
                {completedViaFilter !== "all" && <input type="hidden" name="completed_via" value={completedViaFilter} />}
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
              <PaginationButtons page={page} totalPages={totalPages} hrefForPage={pageHref} />
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}