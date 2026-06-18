import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card, Badge } from "@/components/ui";
import Link from "next/link";
import { ArrowRight, Building2, Users, ShieldCheck, History, Printer, Search, ChevronLeft, ChevronRight, CalendarDays, RotateCcw, FileSpreadsheet, Download } from "lucide-react";
import { OpticsDeductForm } from "@/components/optics-deduct-form";
import { OpticsAddTransactionButton } from "@/components/optics-add-transaction-button";
import { formatDateTripoli } from "@/lib/datetime";
import { TransactionCancelButton } from "@/components/transaction-cancel-button";
import { TransactionEditModal } from "@/components/transaction-edit-modal";
import { BeneficiaryCreateModal } from "@/components/beneficiary-create-modal";
import { BeneficiaryEditModal } from "@/components/beneficiary-edit-modal";
import { BeneficiaryDeleteButton } from "@/components/beneficiary-delete-button";
import { BeneficiaryTransactionsPanelButton } from "@/components/beneficiary-transactions-panel-button";
import { BeneficiaryRestoreActions } from "@/components/beneficiary-restore-actions";
import { BeneficiariesBulkActionButton, SelectAllCheckbox, EmptyRecycleBinButton } from "@/components/beneficiaries-bulk-action-button";
import { TransactionsBulkActionButton, SelectAllTransactionsCheckbox } from "@/components/transactions-bulk-action-button";
import { getServiceAlias } from "@/lib/service-aliases";

export default async function OpticsCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    tab?: string;
    q?: string;
    page?: string;
    from?: string;
    to?: string;
    view?: string;
    bulk_msg?: string;
    bulk_type?: string;
  }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  const canAccess = hasPermission(session, "optics_services");
  if (!canAccess) redirect("/dashboard");


  const canViewBeneficiaries = session.is_admin || hasPermission(session, "view_optics_beneficiaries");
  const { companyId } = await params;
  const sp = await searchParams;
  let activeTab = sp.tab === "transactions" ? "transactions" : sp.tab === "beneficiaries" ? "beneficiaries" : "deduct";
  if (!canViewBeneficiaries && activeTab === "beneficiaries") {
    activeTab = "deduct";
  }
  const searchQuery = (sp.q ?? "").trim();
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const fromDate = sp.from ?? "";
  const toDate = sp.to ?? "";

  // جلب بيانات الشركة مع إحصائيات المستفيدين
  const company = (await prisma.insuranceCompany.findUnique({
    where: { id: companyId, deleted_at: null, is_active: true },
    include: {
      _count: {
        select: { beneficiaries: { where: { deleted_at: null } } },
      },
      service_policies: {
        where: { service_type: { code: 'OPTICS' } },
        select: { ceiling_amount: true, coverage_percent: true }
      }
    },
  })) as any;

  if (!company) notFound();

  const policy = company.service_policies?.[0];
  const ceiling = policy && policy.ceiling_amount !== null ? Number(policy.ceiling_amount) : null;
  const copay = Math.max(0, 100 - (policy ? Number(policy.coverage_percent) : 100));
  const opticsPolicy = true;

  // تحديد نوع المستخدم وهل هو مرفق
  const isFacility = session.role === "FACILITY" || (!session.is_admin && !session.is_manager && !session.is_employee);

  // بناء شروط الاستعلام لحركات البصريات
  // المرفق يرى حركاته فقط، والمشرف/المدير يرى جميع الحركات
  const canAddManualTransaction = !isFacility && (session.is_admin || hasPermission(session, "add_manual_transaction"));
  const PAGE_SIZE = 10;
  const where: any = {
    company_id: companyId,
    type: "OPTICS",
    is_cancelled: false,
    ...(isFacility ? { facility_id: session.id } : {}),
  };

  if (searchQuery) {
    where.OR = [
      { beneficiary: { name: { contains: searchQuery, mode: "insensitive" } } },
      { beneficiary: { card_number: { contains: searchQuery, mode: "insensitive" } } },
    ];
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

  // جلب المرافق والتحقق من الصلاحيات
  // الإدارة والمشرف يحتاج قائمة المرافق الكاملة للاقتطاع
  const facilities: Array<{ id: string; name: string }> = !isFacility
    ? await prisma.facility.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [{ id: session.id, name: session.name }];

  const isReadOnlyEmployee = session.is_employee;
  const canCancel = !isReadOnlyEmployee && hasPermission(session, "cancel_transactions");
  const canCorrect = !isReadOnlyEmployee && hasPermission(session, "correct_transactions");
  const canEditTransaction = !isReadOnlyEmployee && hasPermission(session, "edit_transaction");
  const canDelete = !isReadOnlyEmployee && hasPermission(session, "delete_transaction");
  const canSingleAction = session.is_admin || canCancel || canCorrect;

  const canEditBen = hasPermission(session, "edit_beneficiary");
  const canDeleteBen = hasPermission(session, "delete_beneficiary");
  const canAddBen = session.is_admin || hasPermission(session, "add_beneficiary");
  const canManageRecycleBin = hasPermission(session, "manage_recycle_bin");
  const canExport = session.is_admin || hasPermission(session, "export_data");

  // جلب الحركات المصفاة والمرقمنة وإحصائياتها
  const [totalCount, recentTransactions, stats] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        beneficiary: {
          select: {
            id: true,
            name: true,
            card_number: true,
            remaining_balance: true,
          },
        },
        facility: {
          select: {
            id: true,
            name: true,
          },
        },
        corrections: {
          where: { type: "CANCELLATION", is_cancelled: false },
          select: { id: true, amount: true, is_cancelled: true },
          take: 1,
        },
      },
    }),
    prisma.transaction.aggregate({
      where,
      _sum: { amount: true, actual_company_share: true, actual_patient_share: true },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const totalAmount = Number(stats._sum.amount ?? 0);
  const totalCompanyShare = Number(stats._sum.actual_company_share ?? 0);
  const totalPatientShare = Number(stats._sum.actual_patient_share ?? 0);

  // ─── حساب الأرصدة المتبقية لحركات البصريات ديناميكياً لتجنب مشاكل الـ null والـ 600 ───
  const uniqueBenIdsForTxs = Array.from(new Set(recentTransactions.map((tx) => tx.beneficiary_id)));
  const allBenOpticsTxs = uniqueBenIdsForTxs.length > 0
    ? await prisma.transaction.findMany({
        where: {
          beneficiary_id: { in: uniqueBenIdsForTxs },
          company_id: companyId,
          type: "OPTICS",
          is_cancelled: false,
        },
        orderBy: [
          { created_at: "asc" },
          { id: "asc" },
        ],
        select: {
          id: true,
          beneficiary_id: true,
          ceiling_consumed: true,
          amount: true,
          actual_company_share: true,
        },
      })
    : [];

  const txsByBenMap = new Map();
  for (const t of allBenOpticsTxs) {
    if (!txsByBenMap.has(t.beneficiary_id)) {
      txsByBenMap.set(t.beneficiary_id, []);
    }
    txsByBenMap.get(t.beneficiary_id).push(t);
  }

  const remainingAfterTxId = new Map();
  const accumulatedSpentByTxId = new Map();
  const opticsCeiling = ceiling;

  for (const [_benId, benTxs] of txsByBenMap.entries()) {
    let accumulatedSpent = 0;
    for (const t of benTxs) {
      const consumed = t.ceiling_consumed !== null
        ? Number(t.ceiling_consumed)
        : Number(t.actual_company_share ?? t.amount);
      accumulatedSpent += consumed;
      accumulatedSpentByTxId.set(t.id, accumulatedSpent);
      remainingAfterTxId.set(t.id, opticsCeiling === null ? 999999999 : Math.max(0, opticsCeiling - accumulatedSpent));
    }
  }

  // Use a shared datalist for all modals to save DOM memory
  const globalDatalistId = "facilities-datalist-global";
  const sharedDatalist = (
    <datalist id={globalDatalistId}>
      {facilities.map((f: { id: string; name: string }) => (
        <option key={f.id} value={f.name} />
      ))}
    </datalist>
  );

  // ─── جلب المستفيدين إذا تم تحديد تبويب المستفيدين ───
  let companyBeneficiaries: any[] = [];
  let totalBeneficiariesCount = 0;
  let totalBeneficiariesPages = 0;
  let deletedCount = 0;

  const isDeletedView = sp.view === "deleted";
  const showBeneficiariesBulkRow =
    session.is_admin || (canDeleteBen && !isDeletedView) || (canManageRecycleBin && isDeletedView);
  const bulkMessage = (sp.bulk_msg?.trim() ?? "").slice(0, 220);
  const bulkMessageType: "success" | "error" = sp.bulk_type === "error" ? "error" : "success";

  if (activeTab === "beneficiaries") {
    // جلب عدد المحذوفين ناعماً
    deletedCount = await prisma.beneficiary.count({
      where: {
        company_id: companyId,
        deleted_at: { not: null },
      },
    });

    const benWhere: any = {
      company_id: companyId,
      deleted_at: isDeletedView ? { not: null } : null,
    };
    if (searchQuery) {
      const searchTerms = searchQuery.split(/\s+/).filter(Boolean);
      if (searchTerms.length > 0) {
        benWhere.AND = searchTerms.map(t => ({
          OR: [
            { name: { contains: t, mode: "insensitive" } },
            { card_number: { contains: t, mode: "insensitive" } },
          ]
        }));
      }
    }

    const [benList, benCount] = await Promise.all([
      prisma.beneficiary.findMany({
        where: benWhere,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          card_number: true,
          birth_date: true,
          status: true,
          total_balance: true,
          is_legacy_card: true,
          deleted_at: true,
          _count: {
            select: { transactions: { where: { is_cancelled: false, type: "OPTICS" } } }
          }
        }
      }),
      prisma.beneficiary.count({ where: benWhere })
    ]);

    const benIds = benList.map((b) => b.id);
    
    // Calculate spent optics ceiling per beneficiary in the current fiscal year
    const fiscalYear = new Date().getFullYear();
    const startDate = new Date(fiscalYear, 0, 1);
    const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

    const spentOpticsRows = benIds.length > 0
      ? await prisma.transaction.findMany({
          where: {
            beneficiary_id: { in: benIds },
            company_id: companyId,
            type: "OPTICS",
            is_cancelled: false,
            created_at: { gte: startDate, lte: endDate },
          },
          select: {
            beneficiary_id: true,
            ceiling_consumed: true,
            actual_company_share: true,
            amount: true,
          }
        })
      : [];

    const spentOpticsMap = new Map();
    for (const tx of spentOpticsRows) {
      const benId = tx.beneficiary_id;
      const consumed = tx.ceiling_consumed !== null
        ? Number(tx.ceiling_consumed)
        : Number(tx.actual_company_share ?? tx.amount);
      const deducted = tx.actual_company_share !== null
        ? Number(tx.actual_company_share)
        : Number(tx.amount);

      const existing = spentOpticsMap.get(benId) ?? { consumed: 0, deducted: 0 };
      spentOpticsMap.set(benId, {
        consumed: existing.consumed + consumed,
        deducted: existing.deducted + deducted,
      });
    }

    const opticsCeiling = ceiling;

    companyBeneficiaries = benList.map((b) => {
      const stats = spentOpticsMap.get(b.id) ?? { consumed: 0, deducted: 0 };
      const consumed = stats.consumed;
      const deducted = stats.deducted;

      const remaining = opticsCeiling === null ? consumed : Math.max(0, opticsCeiling - consumed);
      const total = opticsCeiling === null ? deducted : opticsCeiling;

      const dynamicStatus = b.status === "SUSPENDED"
        ? "SUSPENDED"
        : (opticsCeiling !== null && Math.max(0, opticsCeiling - consumed) <= 0 ? "FINISHED" : "ACTIVE");
      return {
        ...b,
        total_balance: total,
        remaining_balance: remaining,
        status: dynamicStatus,
        in_import_file: Boolean(b.is_legacy_card),
      };
    });

    totalBeneficiariesCount = benCount;
    totalBeneficiariesPages = Math.ceil(benCount / PAGE_SIZE);
  }

  const buildPageUrl = (pageNumber: number) => {
    const params = new URLSearchParams();
    params.set("tab", activeTab);
    if (searchQuery) params.set("q", searchQuery);
    if (fromDate && activeTab === "transactions") params.set("from", fromDate);
    if (toDate && activeTab === "transactions") params.set("to", toDate);
    if (isDeletedView && activeTab === "beneficiaries") params.set("view", "deleted");
    params.set("page", String(pageNumber));
    return `/admin/optics-services/${companyId}?${params.toString()}`;
  };

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 dark:border-slate-800 pb-5">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-900/40">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Link href="/admin/optics-services" className="hover:text-teal-600 dark:hover:text-teal-400 font-bold transition-colors">
                  {getServiceAlias(company, 'OPTICS', 'خدمات البصريات')}
                </Link>
                <ArrowRight className="h-3.5 w-3.5 rotate-180" />
                <span className="font-medium">{company.name}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 dark:text-white mt-0.5">
                  {company.name}
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400 font-mono ml-2 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                    {company.code}
                  </span>
                </h1>

                {opticsPolicy && (
                  <div className="mr-1 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-1 w-fit">
                    <Link
                      href={`/admin/optics-services/${companyId}?tab=deduct`}
                      className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                        activeTab === "deduct"
                          ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                      }`}
                    >
                      إجراء الخصم
                    </Link>
                    <Link
                      href={`/admin/optics-services/${companyId}?tab=transactions`}
                      className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                        activeTab === "transactions"
                          ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>آخر الحركات</span>
                        <span className="text-[10px] font-black bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full">
                          {totalCount}
                        </span>
                      </div>
                    </Link>
                    {canViewBeneficiaries && (
                      <Link
                        href={`/admin/optics-services/${companyId}?tab=beneficiaries`}
                        className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                          activeTab === "beneficiaries"
                            ? "bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-700"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>المستفيدين</span>
                          <span className="text-[10px] font-black bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded-full">
                            {company._count.beneficiaries}
                          </span>
                        </div>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs">
              <Users className="h-3.5 w-3.5 text-teal-600" />
              <span className="font-black text-slate-900 dark:text-white">
                {company._count.beneficiaries.toLocaleString("ar-LY")}
              </span>
              <span className="text-slate-500">نشط</span>
            </div>

            {ceiling !== null ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-2.5 py-1.5 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
                <span className="font-black text-teal-800 dark:text-teal-300">
                  {ceiling.toLocaleString("ar-LY")} د.ل
                </span>
                <span className="text-teal-600 dark:text-teal-400">سقف</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1.5 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span className="font-black text-emerald-850 dark:text-teal-300">سقف مفتوح</span>
              </div>
            )}

            {copay > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5 text-xs">
                <span className="font-black text-amber-800 dark:text-amber-300">تحمل {copay}%</span>
              </div>
            )}

            {session.is_admin && (
              <Link
                href={`/admin/optics-transactions/import?companyId=${companyId}`}
                className="flex items-center gap-1.5 rounded-lg border border-slate-350 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-750 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-black transition-all shadow-sm hover:scale-[1.01] active:scale-[0.99] mr-1"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-teal-650" />
                <span>استيراد حركات</span>
              </Link>
            )}

          </div>
        </div>

        {bulkMessage && bulkMessageType === "error" && (
          <div className="rounded-xl border p-4 text-sm font-bold flex items-center justify-between gap-3 shadow-sm border-red-200 bg-red-50 text-red-805 dark:border-red-950/40 dark:bg-red-950/20 dark:text-red-300">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full animate-ping bg-current shrink-0" />
              <span>{bulkMessage}</span>
            </div>
          </div>
        )}

        {!opticsPolicy && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-4">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
              ⚠️ لا توجد سياسة بصريات نشطة لهذه الشركة. يرجى تعريف سياسة من نوع OPTICS من قسم سياسات الخدمات.
            </p>
          </div>
        )}

        {opticsPolicy && activeTab === "deduct" && (
          <OpticsDeductForm
            companyId={companyId}
            companyName={company.name}
            annualCeiling={ceiling}
            copayPercentage={copay}
          />
        )}

        {opticsPolicy && activeTab === "transactions" && (
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              <Card className="p-4 border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/10">
                <p className="text-[10px] font-black uppercase tracking-wider text-teal-600 dark:text-teal-500">إجمالي الحركات</p>
                <p className="mt-1 text-2xl font-black text-teal-800 dark:text-teal-300">{totalCount.toLocaleString("ar-LY")}</p>
              </Card>
              <Card className="p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">إجمالي الفواتير</p>
                <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{totalAmount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-slate-400">د.ل</p>
              </Card>
              <Card className="p-4 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
                <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-500">على الشركة</p>
                <p className="mt-1 text-2xl font-black text-blue-800 dark:text-blue-300">{totalCompanyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-blue-400">د.ل</p>
              </Card>
              <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-500">على المؤمنين</p>
                <p className="mt-1 text-2xl font-black text-amber-800 dark:text-amber-300">{totalPatientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-amber-400">د.ل</p>
              </Card>
            </div>

            <Card className="p-4">
              <form method="GET" action={`/admin/optics-services/${companyId}`} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="tab" value="transactions" />
                <div className="relative flex-1 min-w-52">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    name="q"
                    defaultValue={searchQuery}
                    placeholder="ابحث باسم المستفيد أو رقم البطاقة..."
                    className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pr-9 pl-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">من</span>
                  <input
                    type="date"
                    name="from"
                    defaultValue={fromDate}
                    className="flex h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                  />
                  <span className="text-xs font-bold text-slate-500">إلى</span>
                  <input
                    type="date"
                    name="to"
                    defaultValue={toDate}
                    className="flex h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-md bg-teal-600 hover:bg-teal-700 px-5 text-sm font-black text-white transition-colors cursor-pointer"
                  >
                    تطبيق
                  </button>
                  <Link
                    href={`/admin/optics-services/${companyId}?tab=transactions`}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    إعادة تعيين
                  </Link>
                </div>
              </form>
            </Card>

            <Card className="p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <History className="h-5 w-5 text-teal-600" />
                    سجل الحركات
                  </h2>
                  <span className="text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-2.5 py-1">
                    صفحة {page} من {totalPages || 1}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(session.is_admin || canCancel) && (
                    <TransactionsBulkActionButton
                      formId="transactions-bulk-form"
                      op="cancel_or_rededuct"
                      label="إلغاء المحدد"
                      variant="warning"
                    />
                  )}
                  {(session.is_admin || canDelete) && (
                    <TransactionsBulkActionButton
                      formId="transactions-bulk-form"
                      op="permanent_delete"
                      label="حذف نهائي للمحدد"
                      variant="danger"
                    />
                  )}

                  <Link
                    href={`/admin/optics-services/${companyId}/print?${new URLSearchParams({
                      q: searchQuery,
                      from: fromDate,
                      to: toDate,
                    }).toString()}`}
                    target="_blank"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-xs font-black text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-350 transition-colors shadow-sm"
                  >
                    <Printer className="h-4 w-4 text-teal-600" />
                    <span>طباعة الكشف المصفى</span>
                  </Link>

                  {canExport && (
                    <a
                      href={`/api/optics-export?company=${companyId}&q=${encodeURIComponent(searchQuery)}&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`}
                      target="_blank"
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-xs font-black text-emerald-700 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-350 transition-colors shadow-sm"
                    >
                      <Download className="h-4 w-4 text-emerald-600" />
                      <span>تصدير Excel</span>
                    </a>
                  )}

                  {canAddManualTransaction && (
                    <OpticsAddTransactionButton
                      companyId={companyId}
                      companyName={company.name}
                      facilities={facilities}
                      defaultFacilityId={session.id}
                      canChooseFacility={!isFacility}
                      copayPercentage={copay}
                      annualCeiling={ceiling}
                      opticsSettings={company.optics_settings}
                    />
                  )}
                </div>
              </div>

              <form id="transactions-bulk-form" className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        {(session.is_admin || canCancel || canDelete) && (
                          <th className="px-4 py-3 text-center w-10">
                            <SelectAllTransactionsCheckbox formId="transactions-bulk-form" />
                          </th>
                        )}
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400">المستفيد</th>
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400">رقم البطاقة</th>
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">قيمة الفاتورة</th>
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">حصة الشركة</th>
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">حصة المؤمن</th>
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">
                           {opticsCeiling === null ? "الرصيد المستهلك" : "الرصيد المتبقي"}
                        </th>
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400">المرفق</th>
                        <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400">التاريخ</th>
                        {(session.is_admin || canEditTransaction) && (
                          <th className="px-4 py-3 font-black text-slate-500 dark:text-slate-400 text-center">إجراءات</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {recentTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={9 + ((session.is_admin || canEditTransaction) ? 1 : 0)} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400 font-bold">
                            لا توجد حركات مطابقة للبحث أو معايير الفلترة المحددة.
                          </td>
                        </tr>
                      ) : (
                        recentTransactions.map((tx) => {
                          const amount = Number(tx.amount);
                          const companyShare = tx.actual_company_share !== null ? Number(tx.actual_company_share) : 0;
                          const patientShare = tx.actual_patient_share !== null ? Number(tx.actual_patient_share) : 0;
                          const remaining = remainingAfterTxId.get(tx.id) ?? (tx.remaining_ceiling_after !== null ? Number(tx.remaining_ceiling_after) : (opticsCeiling !== null ? (opticsCeiling - companyShare) : 999999999));
                          const consumedAccumulated = accumulatedSpentByTxId.get(tx.id) ?? companyShare;

                          return (
                            <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                              {(session.is_admin || canCancel || canDelete) && (
                                <td className="px-4 py-3.5 text-center w-10">
                                  <input
                                    type="checkbox"
                                    name="ids"
                                    value={tx.id}
                                    className="h-4 w-4 rounded border-slate-350 dark:border-slate-700 text-teal-650 focus:ring-teal-500/30"
                                  />
                                </td>
                              )}
                              <td className="px-4 py-3.5 font-black text-slate-900 dark:text-white">
                                {tx.beneficiary?.name ?? "—"}
                              </td>
                              <td className="px-4 py-3.5 font-mono font-bold text-slate-650 dark:text-slate-400 text-xs">
                                {tx.beneficiary?.card_number ?? "—"}
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono font-black text-slate-900 dark:text-white">
                                {amount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono font-black text-teal-700 dark:text-teal-400">
                                {companyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono font-black text-amber-600 dark:text-amber-450">
                                {patientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                              </td>
                              <td className="px-4 py-3.5 text-center font-mono font-black text-sky-700 dark:text-sky-400">
                                {remaining !== null && remaining < 99999999 ? (
                                    `${remaining.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل`
                                  ) : (
                                    `${consumedAccumulated.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل`
                                  )}
                              </td>
                              <td className="px-4 py-3.5 font-bold text-slate-600 dark:text-slate-450 text-xs">
                                {tx.facility?.name ?? "—"}
                              </td>
                              <td className="px-4 py-3.5 text-xs">
                                <span className="font-bold text-slate-700 dark:text-slate-300">{formatDateTripoli(tx.created_at)}</span>
                              </td>
                              {(session.is_admin || canEditTransaction) && (
                                <td className="px-4 py-3.5 text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <TransactionEditModal
                                      transaction={{
                                        id: tx.id,
                                        amount: Number(tx.amount),
                                        type: tx.type,
                                        created_at: tx.created_at.toISOString(),
                                        facility_id: tx.facility.id,
                                        facility_name: tx.facility.name,
                                        is_cancelled: tx.is_cancelled,
                                      }}
                                      facilities={facilities}
                                      datalistId={globalDatalistId}
                                    />
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </form>

              {/* أزرار الترقيم Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div className="flex items-center gap-1">
                    {page > 1 ? (
                      <Link
                        href={buildPageUrl(page - 1)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        title="الصفحة السابقة"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <button
                        disabled
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}

                    {page < totalPages ? (
                      <Link
                        href={buildPageUrl(page + 1)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        title="الصفحة التالية"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Link>
                    ) : (
                      <button
                        disabled
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    صفحة {page} من {totalPages} (إجمالي {totalCount} حركة)
                  </span>
                </div>
              )}
            </Card>
          </div>
        )}

        {opticsPolicy && activeTab === "beneficiaries" && (
          <div className="space-y-4">
            <Card className="p-4">
              <form method="GET" action={`/admin/optics-services/${companyId}`} className="flex items-center gap-3">
                <input type="hidden" name="tab" value="beneficiaries" />
                {isDeletedView && <input type="hidden" name="view" value="deleted" />}
                <div className="relative flex-1 min-w-52">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    name="q"
                    defaultValue={searchQuery}
                    placeholder="ابحث باسم المستفيد أو رقم البطاقة..."
                    className="flex h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pr-9 pl-3 py-2 text-sm font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-md bg-teal-600 hover:bg-teal-700 px-5 text-sm font-black text-white transition-colors cursor-pointer"
                  >
                    تطبيق
                  </button>
                  <Link
                    href={`/admin/optics-services/${companyId}?tab=beneficiaries`}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    إعادة تعيين
                  </Link>
                </div>
              </form>
            </Card>

            {/* تبويب عرض النشطين / المحذوفين */}
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/optics-services/${companyId}?tab=beneficiaries${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
                className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-bold transition-colors ${!isDeletedView
                  ? "border-primary/20 bg-primary-light dark:bg-primary-light/10 text-primary dark:text-blue-400 dark:border-primary/30"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
              >
                <Users className="h-4 w-4" />
                النشطون
                <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-xs font-black text-slate-600 dark:text-slate-300">
                  {company._count.beneficiaries}
                </span>
              </Link>
              <Link
                href={`/admin/optics-services/${companyId}?tab=beneficiaries&view=deleted${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
                className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-bold transition-colors ${isDeletedView
                  ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
              >
                <RotateCcw className="h-4 w-4" />
                المحذوفون
                {deletedCount > 0 && (
                  <span className="rounded-full bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-xs font-black text-red-600 dark:text-red-400">
                    {deletedCount}
                  </span>
                )}
              </Link>
            </div>

            <Card className="overflow-hidden p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-sm space-y-4">
              <form id="beneficiaries-bulk-form">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2 whitespace-nowrap">
                      <Users className="h-5 w-5 text-teal-600" />
                      {isDeletedView ? "سلة المحذوفات للمستفيدين" : "قائمة مستفيدي هذه الشركة"}
                    </h2>
                    <span className="shrink-0 text-[10px] font-black text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-2.5 py-1">
                      صفحة {page} من {totalBeneficiariesPages || 1}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!isDeletedView && canAddBen && <BeneficiaryCreateModal companyId={companyId} />}
                    {canExport && (
                      <a
                        href={`/api/export/beneficiaries?company_id=${companyId}&is_optics=1${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}${isDeletedView ? `&view=deleted` : ""}`}
                        target="_blank"
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-xs font-black text-emerald-700 dark:text-emerald-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-350 transition-colors shadow-sm"
                      >
                        <Download className="h-4 w-4 text-emerald-600" />
                        <span>تصدير Excel</span>
                      </a>
                    )}
                    {showBeneficiariesBulkRow && (
                      <>
                        <BeneficiariesBulkActionButton formId="beneficiaries-bulk-form" mode={isDeletedView ? "permanent" : "soft"} />
                        {isDeletedView && canManageRecycleBin && <BeneficiariesBulkActionButton formId="beneficiaries-bulk-form" mode="restore" />}
                        {isDeletedView && canManageRecycleBin && <EmptyRecycleBinButton disabled={deletedCount === 0} />}
                      </>
                    )}
                  </div>
                </div>

                {/* ══ عرض الكارد — جوال فقط ══ */}
                <div className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {companyBeneficiaries.length === 0 ? (
                    <p className="py-10 text-center text-sm italic text-slate-500 dark:text-slate-400">
                      {isDeletedView ? "لا يوجد مستفيدون محذوفون." : "لا توجد نتائج مطابقة."}
                    </p>
                  ) : (
                    companyBeneficiaries.map((beneficiary) => (
                      <div key={beneficiary.id} className="px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {(session.is_admin || (canDeleteBen && !isDeletedView) || (canManageRecycleBin && isDeletedView)) && (
                                <input
                                  type="checkbox"
                                  form="beneficiaries-bulk-form"
                                  name="ids"
                                  value={beneficiary.id}
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
                                />
                              )}
                              <p className="font-black text-slate-900 dark:text-white">{beneficiary.name}</p>
                              <Badge variant={beneficiary.status === "ACTIVE" ? "success" : beneficiary.status === "SUSPENDED" ? "warning" : "default"}>
                                {beneficiary.status === "ACTIVE" ? "نشط" : beneficiary.status === "SUSPENDED" ? "موقوف" : "مكتمل"}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400">بطاقة: {beneficiary.card_number}</p>
                            {beneficiary.birth_date && (
                              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{formatDateTripoli(beneficiary.birth_date, "en-GB")}</p>
                            )}
                            {!isDeletedView && (
                              <div className="mt-1.5 flex gap-3 text-xs font-bold">
                                {opticsCeiling === null ? (
                                  <>
                                    <span className="text-slate-600 dark:text-slate-300">الرصيد الكلي: سقف مفتوح</span>
                                    <span className="text-slate-400">|</span>
                                    <span className="text-sky-700 dark:text-sky-300">مستهلك: {Number(beneficiary.total_balance).toLocaleString("ar-LY")} د.ل</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-slate-600 dark:text-slate-300">الرصيد الكلي: {Number(beneficiary.total_balance).toLocaleString("ar-LY")} د.ل</span>
                                    <span className="text-slate-400">|</span>
                                    <span className="text-sky-700 dark:text-sky-300">متبقي: {Number(beneficiary.remaining_balance).toLocaleString("ar-LY")} د.ل</span>
                                  </>
                                )}
                              </div>
                            )}
                            {isDeletedView && beneficiary.deleted_at && (
                              <p className="mt-0.5 text-xs text-red-400 dark:text-red-500">محذوف: {formatDateTripoli(beneficiary.deleted_at, "en-GB")}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
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
                                <BeneficiaryTransactionsPanelButton
                                  beneficiaryId={beneficiary.id}
                                  beneficiaryName={beneficiary.name}
                                  hasTransactions={beneficiary._count.transactions > 0}
                                  overrideTotalBalance={opticsCeiling === null ? undefined : Number(beneficiary.total_balance)}
                                  overrideRemainingBalance={opticsCeiling === null ? Number(beneficiary.total_balance) : Number(beneficiary.remaining_balance)}
                                  overrideConsumedBalance={opticsCeiling === null ? Number(beneficiary.total_balance) : Number(beneficiary.total_balance) - Number(beneficiary.remaining_balance)}
                                  contextLabel="بصريات"
                                  serviceContextFilter="OPTICS"
                                />

                                {canEditBen && (
                                  <BeneficiaryEditModal
                                    iconOnly
                                    beneficiary={{
                                      id: beneficiary.id,
                                      name: beneficiary.name,
                                      card_number: beneficiary.card_number,
                                      birth_date: beneficiary.birth_date ? new Date(beneficiary.birth_date).toISOString().slice(0, 10) : "",
                                      status: beneficiary.status,
                                      is_legacy_card: beneficiary.in_import_file,
                                      total_balance: Number(beneficiary.total_balance),
                                      remaining_balance: Number(beneficiary.remaining_balance),
                                    }}
                                  />
                                )}
                                {canDeleteBen && (
                                  <BeneficiaryDeleteButton
                                    id={beneficiary.id}
                                    name={beneficiary.name}
                                    hasTransactions={beneficiary._count.transactions > 0}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* ══ عرض الجدول — شاشة كبيرة فقط ══ */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full min-w-200 border-collapse text-right">
                    <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                      <tr>
                        {(session.is_admin || (canDeleteBen && !isDeletedView) || (canManageRecycleBin && isDeletedView)) && (
                          <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                            <div className="flex items-center gap-2">
                              <SelectAllCheckbox formId="beneficiaries-bulk-form" />
                              <span>تحديد</span>
                            </div>
                          </th>
                        )}
                        <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المستفيد</th>
                        <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">رقم البطاقة</th>
                        <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">تاريخ الميلاد</th>
                        {!isDeletedView && (
                          <>
                            <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                              الرصيد الكلي
                            </th>
                            <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">
                              {opticsCeiling === null ? "الرصيد المستهلك" : "الرصيد المتبقي"}
                            </th>
                          </>
                        )}
                        <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">الحالة</th>
                        {isDeletedView && <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">تاريخ الحذف</th>}
                        {(canEditBen || canDeleteBen || canManageRecycleBin || session.is_admin) && (
                          <th className="px-6 py-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500 text-center">إجراءات</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {companyBeneficiaries.length === 0 ? (
                        <tr>
                          <td
                            colSpan={
                              4 +
                              (!isDeletedView ? 2 : 0) +
                              (isDeletedView ? 1 : 0) +
                              ((session.is_admin || (canDeleteBen && !isDeletedView) || (canManageRecycleBin && isDeletedView)) ? 1 : 0) +
                              ((canEditBen || canDeleteBen || canManageRecycleBin || session.is_admin) ? 1 : 0)
                            }
                            className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                          >
                            {isDeletedView ? "سلة المحذوفات فارغة." : "لا توجد نتائج مطابقة."}
                          </td>
                        </tr>
                      ) : (
                        companyBeneficiaries.map((beneficiary) => (
                          <tr key={beneficiary.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            {(session.is_admin || (canDeleteBen && !isDeletedView) || (canManageRecycleBin && isDeletedView)) && (
                              <td className="px-4 py-4">
                                <input
                                  type="checkbox"
                                  form="beneficiaries-bulk-form"
                                  name="ids"
                                  value={beneficiary.id}
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
                              <>
                                <td className="px-6 py-4 text-sm font-bold text-slate-700 dark:text-slate-300">
                                  {opticsCeiling === null ? "سقف مفتوح" : `${Number(beneficiary.total_balance).toLocaleString("ar-LY")} د.ل`}
                                </td>
                                <td className="px-6 py-4 text-sm font-bold text-sky-700 dark:text-sky-300">
                                  {opticsCeiling === null 
                                    ? `${Number(beneficiary.total_balance).toLocaleString("ar-LY")} د.ل`
                                    : `${Number(beneficiary.remaining_balance).toLocaleString("ar-LY")} د.ل`}
                                </td>
                              </>
                            )}
                            <td className="px-6 py-4">
                              <Badge variant={beneficiary.status === "ACTIVE" ? "success" : beneficiary.status === "SUSPENDED" ? "warning" : "default"}>
                                {beneficiary.status === "ACTIVE" ? "نشط" : beneficiary.status === "SUSPENDED" ? "موقوف" : "مكتمل"}
                              </Badge>
                            </td>
                            {isDeletedView && beneficiary.deleted_at && (
                              <td className="px-6 py-4 text-sm text-red-500 dark:text-red-400">
                                {formatDateTripoli(beneficiary.deleted_at, "en-GB")}
                              </td>
                            )}
                            {(canEditBen || canDeleteBen || canManageRecycleBin || session.is_admin) && (
                              <td className="px-6 py-4 text-center">
                                <div className="flex items-center justify-center gap-1.5">
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
                                      <BeneficiaryTransactionsPanelButton
                                        beneficiaryId={beneficiary.id}
                                        beneficiaryName={beneficiary.name}
                                        hasTransactions={beneficiary._count.transactions > 0}
                                        overrideTotalBalance={opticsCeiling === null ? undefined : Number(beneficiary.total_balance)}
                                        overrideRemainingBalance={opticsCeiling === null ? Number(beneficiary.total_balance) : Number(beneficiary.remaining_balance)}
                                        overrideConsumedBalance={opticsCeiling === null ? Number(beneficiary.total_balance) : Number(beneficiary.total_balance) - Number(beneficiary.remaining_balance)}
                                        contextLabel="بصريات"
                                        serviceContextFilter="OPTICS"
                                      />

                                      {canEditBen && (
                                        <BeneficiaryEditModal
                                          iconOnly
                                          beneficiary={{
                                            id: beneficiary.id,
                                            name: beneficiary.name,
                                            card_number: beneficiary.card_number,
                                            birth_date: beneficiary.birth_date ? new Date(beneficiary.birth_date).toISOString().slice(0, 10) : "",
                                            status: beneficiary.status,
                                            is_legacy_card: beneficiary.in_import_file,
                                            total_balance: Number(beneficiary.total_balance),
                                            remaining_balance: Number(beneficiary.remaining_balance),
                                          }}
                                        />
                                      )}
                                      {canDeleteBen && (
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

              {/* أزرار الترقيم Pagination */}
              {totalBeneficiariesPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div className="flex items-center gap-1">
                    {page > 1 ? (
                      <Link
                        href={buildPageUrl(page - 1)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        title="الصفحة السابقة"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <button
                        disabled
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}

                    {page < totalBeneficiariesPages ? (
                      <Link
                        href={buildPageUrl(page + 1)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        title="الصفحة التالية"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Link>
                    ) : (
                      <button
                        disabled
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-slate-300 dark:text-slate-600 cursor-not-allowed"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    صفحة {page} من {totalBeneficiariesPages} (إجمالي {totalBeneficiariesCount} مستفيد)
                  </span>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
      {sharedDatalist}
    </Shell>
  );
}

