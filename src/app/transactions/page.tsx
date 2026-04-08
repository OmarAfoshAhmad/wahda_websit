import { getSession } from "@/lib/auth";
import { canAccessAdmin, hasPermission } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Shell } from "@/components/shell";
import { getArabicSearchTerms } from "@/lib/search";
import { Card, Badge, Input, Button } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ExportButton } from "@/components/export-button";
import { PaginationButtons } from "@/components/pagination-buttons";
import { bulkTransactionSelectionAction } from "@/app/actions/cancel-transaction";
import { BulkTransactionActionButton } from "@/components/bulk-transaction-action-button";
import { SelectAllTransactionsCheckbox } from "@/components/select-all-transactions-checkbox";
import { TransactionEditModal } from "../../components/transaction-edit-modal";
import Link from "next/link";
import { FileInput, PlusCircle } from "lucide-react";

type TransactionRow = {
  id: string;
  beneficiary_id: string;
  amount: unknown;
  type: string;
  is_cancelled: boolean;
  created_at: Date;
  corrections: Array<{
    id: string;
    amount: unknown;
    is_cancelled: boolean;
  }>;
  original_transaction: {
    id: string;
    amount: unknown;
    is_cancelled: boolean;
  } | null;
  beneficiary: {
    name: string;
    card_number: string;
    remaining_balance: unknown;
  };
  facility: {
    id: string;
    name: string;
  };
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ start_date?: string; end_date?: string; facility_id?: string; page?: string; q?: string; sort?: string; order?: string; status?: string; source?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { start_date, end_date, facility_id, page: pageParam, q, sort, order, status, source } = await searchParams;
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const facilities: Array<{ id: string; name: string }> = canAccessAdmin(session)
    ? await prisma.facility.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [{ id: session.id, name: session.name }];

  const rawFacilityFilter = (facility_id ?? "").trim();
  const selectedFacility = facilities.find((f) => f.id === rawFacilityFilter || f.name === rawFacilityFilter);
  const resolvedFacilityId = canAccessAdmin(session) ? selectedFacility?.id : session.id;
  const facilityFilterInputValue = canAccessAdmin(session)
    ? (selectedFacility?.name ?? rawFacilityFilter)
    : session.name;

  const ALLOWED_STATUS = ["all", "active", "cancelled", "cancellation", "deleted"] as const;
  type TxStatus = typeof ALLOWED_STATUS[number];
  const statusFilter: TxStatus = (ALLOWED_STATUS as ReadonlyArray<string>).includes(status ?? "") ? status as TxStatus : "all";

  const ALLOWED_SOURCE = ["all", "manual", "import"] as const;
  type TxSource = typeof ALLOWED_SOURCE[number];
  const sourceFilter: TxSource = session.is_admin && (ALLOWED_SOURCE as ReadonlyArray<string>).includes(source ?? "") ? source as TxSource : "all";

  const TX_SORT_COLS = ["created_at", "amount", "beneficiary_name", "facility_name", "remaining_balance"] as const;
  type TxSortCol = typeof TX_SORT_COLS[number];
  const sortCol: TxSortCol = (TX_SORT_COLS as ReadonlyArray<string>).includes(sort ?? "") ? sort as TxSortCol : "created_at";
  const sortDir: "asc" | "desc" = order === "asc" ? "asc" : "desc";

  const txOrderByMap: Record<TxSortCol, object> = {
    created_at: { created_at: sortDir },
    amount: { amount: sortDir },
    beneficiary_name: { beneficiary: { name: sortDir } },
    facility_name: { facility: { name: sortDir } },
    remaining_balance: { beneficiary: { remaining_balance: sortDir } },
  };

  const buildTxParams = (overrides: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (start_date) p.set("start_date", start_date);
    if (end_date) p.set("end_date", end_date);
    if (facility_id) p.set("facility_id", facility_id);
    if (q) p.set("q", q);
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (sourceFilter !== "all") p.set("source", sourceFilter);
    p.set("sort", sortCol);
    p.set("order", sortDir);
    Object.entries(overrides).forEach(([k, v]) => p.set(k, v));
    return p.toString();
  };

  const txSortHref = (col: string) => {
    return `/transactions?${buildTxParams({ sort: col, order: sortCol === col && sortDir === "asc" ? "desc" : "asc" })}`;
  };

  const txPageHref = (p: number) => {
    return `/transactions?${buildTxParams({ page: String(p) })}`;
  };

  // كل مرفق يرى حركاته فقط — المشرف يرى الكل ويمكنه الفلترة
  const where: Prisma.TransactionWhereInput = canAccessAdmin(session)
    ? (resolvedFacilityId ? { facility_id: resolvedFacilityId } : {})
    : { facility_id: session.id };

  // فلتر الحالة
  if (statusFilter === "active") {
    where.is_cancelled = false;
    where.type = { not: "CANCELLATION" };
  } else if (statusFilter === "cancelled") {
    where.is_cancelled = true;
    where.corrections = { some: { type: "CANCELLATION", is_cancelled: false } };
  } else if (statusFilter === "cancellation") {
    where.is_cancelled = false;
    where.type = "CANCELLATION";
  } else if (statusFilter === "deleted") {
    where.is_cancelled = true;
    where.corrections = { none: { type: "CANCELLATION", is_cancelled: false } };
  } else {
    where.OR = [
      { is_cancelled: false },
      {
        is_cancelled: true,
        corrections: { some: { type: "CANCELLATION", is_cancelled: false } },
      },
    ];
  }

  // فلتر المصدر (يدوي / استيراد) — المبرمج فقط
  if (session.is_admin && sourceFilter === "import") {
    if (where.type) {
      // إذا كان هناك فلتر type سابق (مثل CANCELLATION)، ندمجهما بـ AND
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { type: "IMPORT" }];
    } else {
      where.type = "IMPORT";
    }
  } else if (session.is_admin && sourceFilter === "manual") {
    if (where.type) {
      // إذا كان هناك فلتر type سابق (مثل CANCELLATION)، نتركه
    } else {
      where.type = { in: ["MEDICINE", "SUPPLIES"] };
    }
  }

  // فلترة بالبحث (اسم أو رقم بطاقة)
  const searchQuery = q?.trim().slice(0, 100) ?? "";
  if (searchQuery !== "") {
    const searchOr = getArabicSearchTerms(searchQuery).flatMap(t => [
      { beneficiary: { name: { contains: t, mode: "insensitive" as const } } },
      { beneficiary: { card_number: { contains: t, mode: "insensitive" as const } } },
    ]);

    const existingAnd = Array.isArray(where.AND)
      ? where.AND
      : where.AND
        ? [where.AND]
        : [];

    where.AND = [...existingAnd, { OR: searchOr }];
  }

  // فلترة بالتاريخ (من - إلى)
  // عند عدم تحديد أي تاريخ: نعرض آخر 30 يوم فقط لضمان الأداء
  const hasDateFilter = !!(start_date || end_date);
  where.created_at = {};
  if (start_date) {
    const start = new Date(start_date);
    if (!isNaN(start.getTime())) {
      where.created_at.gte = start;
    }
  } else if (!hasDateFilter) {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    defaultStart.setHours(0, 0, 0, 0);
    where.created_at.gte = defaultStart;
  }
  if (end_date) {
    const end = new Date(end_date);
    if (!isNaN(end.getTime())) {
      // نضبط الوقت لنهاية اليوم لضمان شمولية اليوم المحدد
      end.setHours(23, 59, 59, 999);
      where.created_at.lte = end;
    }
  }

  const [transactions, totalCount, aggregate] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: txOrderByMap[sortCol],
      select: {
        id: true,
        beneficiary_id: true,
        amount: true,
        type: true,
        is_cancelled: true,
        created_at: true,
        corrections: {
          where: { type: "CANCELLATION", is_cancelled: false },
          select: { id: true, amount: true, is_cancelled: true },
          take: 1,
        },
        original_transaction: {
          select: { id: true, amount: true, is_cancelled: true },
        },
        beneficiary: { select: { name: true, card_number: true, remaining_balance: true } },
        facility: { select: { id: true, name: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.transaction.count({ where }),
    hasDateFilter
      ? prisma.transaction.aggregate({ where, _sum: { amount: true } })
      : Promise.resolve({ _sum: { amount: 0 } }),
  ]);

  const transactionRows = transactions as TransactionRow[];
  const displayedBeneficiaryIds = [...new Set(transactionRows.map((tx) => tx.beneficiary_id))];
  const maxDisplayedCreatedAt = transactionRows.reduce<Date | null>((acc, tx) => {
    if (!acc || tx.created_at > acc) return tx.created_at;
    return acc;
  }, null);

  const historicalBalanceByTxId = new Map<string, number>();
  if (displayedBeneficiaryIds.length > 0 && maxDisplayedCreatedAt) {
    const [beneficiaryTotals, historyRows] = await Promise.all([
      prisma.beneficiary.findMany({
        where: { id: { in: displayedBeneficiaryIds } },
        select: { id: true, total_balance: true },
      }),
      prisma.transaction.findMany({
        where: {
          beneficiary_id: { in: displayedBeneficiaryIds },
          created_at: { lte: maxDisplayedCreatedAt },
        },
        select: {
          id: true,
          beneficiary_id: true,
          amount: true,
          type: true,
          is_cancelled: true,
          original_transaction_id: true,
          created_at: true,
        },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
      }),
    ]);

    const runningByBeneficiary = new Map<string, number>(
      beneficiaryTotals.map((b) => [b.id, Number(b.total_balance)])
    );

    const correctedOriginalIds = new Set(
      historyRows
        .filter((tx) => tx.type === "CANCELLATION" && !tx.is_cancelled && tx.original_transaction_id)
        .map((tx) => tx.original_transaction_id as string)
    );

    for (const tx of historyRows) {
      const isActiveCancellation = tx.type === "CANCELLATION" && !tx.is_cancelled;
      const isOriginalWithCorrection = tx.type !== "CANCELLATION" && correctedOriginalIds.has(tx.id);
      const isActiveDeduction = tx.type !== "CANCELLATION" && !tx.is_cancelled;

      if (!isActiveCancellation && !isOriginalWithCorrection && !isActiveDeduction) {
        continue;
      }

      const current = runningByBeneficiary.get(tx.beneficiary_id) ?? 0;
      let next = current;

      if (tx.type === "CANCELLATION") {
        next = current + Math.abs(Number(tx.amount));
      } else {
        next = current - Number(tx.amount);
      }

      runningByBeneficiary.set(tx.beneficiary_id, next);
      historicalBalanceByTxId.set(tx.id, Math.max(0, next));
    }
  }

  const canCancel = hasPermission(session, "cancel_transactions");
  const canCorrect = hasPermission(session, "correct_transactions");
  const canDelete = hasPermission(session, "delete_transaction");
  const canExport = hasPermission(session, "export_data");
  const canImport = session.is_admin || ((session.manager_permissions as Partial<Record<string, boolean>> | null)?.import_transactions === true);

  const totalAmount = aggregate._sum.amount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Use a shared datalist for all modals to save DOM memory
  const globalDatalistId = "facilities-datalist-global";
  const sharedDatalist = (
    <datalist id={globalDatalistId}>
      {facilities.map((f: { id: string; name: string }) => (
        <option key={f.id} value={f.name} />
      ))}
    </datalist>
  );

  return (
    <Shell facilityName={session.name} session={session}>
      <div id="printable-report" className="space-y-4 pb-20">

        {/* ترويسة الطباعة فقط */}
        <div className="hidden print:flex flex-col items-center justify-center mb-2 text-center border-b pb-2 pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Waha Health Care" className="h-16 w-auto object-contain mb-2" />
          <h1 className="text-xl font-black text-black">Waha Health Care</h1>
          <h2 className="text-lg font-bold text-black mt-1">سجل الحركات (المراجعة الطبية)</h2>
          <p className="text-sm text-black mt-1 opacity-75">تاريخ استخراج التقرير: {new Date().toLocaleDateString("en-GB")}</p>
          {session.is_admin && resolvedFacilityId && <p className="text-sm font-bold mt-1 text-black">خاص بالمرفق: {selectedFacility?.name}</p>}
        </div>

        <div className="print:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-black text-slate-900 dark:text-white sm:text-2xl">سجل الحركات (المراجعة الطبية)</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {hasDateFilter ? "نتائج مفلترة" : "آخر 30 يوم — حدد تاريخاً لعرض فترة مختلفة"}
              </p>
            </div>
            {/* أزرار الرأس — أيقونات فقط على الجوال، نص كامل على الشاشات الكبيرة */}
            <div className="no-print flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Link
                href="/add-transaction"
                title="إضافة حركة يدوية"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 sm:w-auto sm:gap-1.5 sm:px-3"
              >
                <PlusCircle className="h-4 w-4 shrink-0" />
                <span className="hidden text-sm font-bold sm:inline">إضافة حركة يدوية</span>
              </Link>
              {canImport && (
                <Link
                  href="/import-transactions"
                  title="استيراد الحركات المجمعة"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 sm:w-auto sm:gap-1.5 sm:px-3"
                >
                  <FileInput className="h-4 w-4 shrink-0" />
                  <span className="hidden text-sm font-bold sm:inline">استيراد الحركات المجمعة</span>
                </Link>
              )}
              {canImport && (
                <Link
                  href="/import-report"
                  title="استيراد حركات قديمة"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 sm:w-auto sm:gap-1.5 sm:px-3"
                >
                  <FileInput className="h-4 w-4 shrink-0" />
                  <span className="hidden text-sm font-bold sm:inline">استيراد حركات قديمة</span>
                </Link>
              )}
              {canExport && <ExportButton searchParams={{ start_date, end_date, facility_id, q }} />}
              <PrintButton />
            </div>
          </div>
        </div>

        {/* ملخص التقرير */}
        {(start_date || end_date) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
            <Card className="p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/50">
              <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">إجمالي المبلغ</p>
              <p className="text-2xl font-black text-blue-900 dark:text-blue-100 mt-1">{Number(totalAmount).toLocaleString("ar-LY")} د.ل</p>
            </Card>
            <Card className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-900/50">
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase">عدد العمليات</p>
              <p className="text-2xl font-black text-emerald-900 dark:text-emerald-100 mt-1">{totalCount.toLocaleString("ar-LY")}</p>
            </Card>
            <Card className="p-4 bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">الفترة</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-2 dir-rtl">
                {start_date ? `من ${start_date}` : "من البداية"}
                {" - "}
                {end_date ? `إلى ${end_date}` : "إلى الآن"}
              </p>
            </Card>
          </div>
        )}

        <form className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-end" method="get">
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="start_date" value={start_date ?? ""} />
          <input type="hidden" name="end_date" value={end_date ?? ""} />
          <input type="hidden" name="facility_id" value={facility_id ?? ""} />
          {statusFilter !== "all" && <input type="hidden" name="status" value={statusFilter} />}
          {sourceFilter !== "all" && <input type="hidden" name="source" value={sourceFilter} />}
          <div className="w-full">
            <label className="block text-xs font-black text-slate-400 mb-1">بحث باسم المستفيد أو رقم البطاقة</label>
            <Input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="ابحث باسم المستفيد أو رقم البطاقة..."
              className="h-10 text-sm"
              autoComplete="off"
              dir="auto"
            />
          </div>
          <Button type="submit" className="mt-2 h-10 w-full sm:mt-0 sm:w-auto">بحث</Button>
        </form>

        <Card className="p-3.5 sm:p-4">
          <form className="flex flex-col gap-4">
            <input type="hidden" name="page" value="1" />
            <input type="hidden" name="q" value={q ?? ""} />

            <div className={`grid grid-cols-1 gap-4 ${session.is_admin ? "md:grid-cols-6" : "md:grid-cols-4"}`}>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">من تاريخ</label>
                <Input type="date" name="start_date" defaultValue={start_date} lang="en-GB" className="[direction:ltr] text-right" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">إلى تاريخ</label>
                <Input type="date" name="end_date" defaultValue={end_date} lang="en-GB" className="[direction:ltr] text-right" />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">الحالة</label>
                <select
                  name="status"
                  defaultValue={statusFilter}
                  className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <option value="all">كل الحركات</option>
                  <option value="active">منفذة فعلياً</option>
                  <option value="cancelled">ملغاة</option>
                  <option value="cancellation">إلغاء حركة (تصحيح)</option>
                  <option value="deleted">محذوفة (حذف ناعم)</option>
                </select>
              </div>

              {session.is_admin && (
                <div className="space-y-1">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">المرفق</label>
                  <Input
                    name="facility_id"
                    defaultValue={facilityFilterInputValue}
                    placeholder="كل المرافق"
                    list="facilities-list"
                    autoComplete="off"
                  />
                  <datalist id="facilities-list">
                    {facilities.map((f: { id: string; name: string }) => (
                      <option key={f.id} value={f.name} />
                    ))}
                  </datalist>
                </div>
              )}

              {session.is_admin && (
                <div className="space-y-1">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">المصدر</label>
                  <select
                    name="source"
                    defaultValue={sourceFilter}
                    className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    <option value="all">الكل</option>
                    <option value="manual">يدوي</option>
                    <option value="import">استيراد</option>
                  </select>
                </div>
              )}

              <div className="flex items-end">
                <button type="submit" className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-primary-dark">
                  عرض التقرير
                </button>
              </div>
            </div>
          </form>
        </Card>

        {/* ══ عرض الكارد — جوال فقط ══ */}
        <div className="flex flex-col gap-3 sm:hidden">
          {transactions.length === 0 ? (
            <p className="py-10 text-center italic text-slate-500">لا توجد نتائج مطابقة للفلاتر الحالية.</p>
          ) : (
            transactions.map((tx: TransactionRow) => (
              <Card key={tx.id} className="overflow-hidden p-0">
                {/* رأس الكارد */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-800/30 px-4 py-2.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(tx.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    {" · "}
                    {new Date(tx.created_at).toLocaleTimeString("ar-LY", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant={tx.type === "MEDICINE" || tx.type === "IMPORT" ? "default" : "warning"}>
                      {tx.type === "MEDICINE" ? "ادوية صرف عام" : tx.type === "IMPORT" ? (session.is_admin ? "استيراد" : "ادوية صرف عام") : "كشف عام"}
                    </Badge>
                    {session.is_admin && tx.type === "IMPORT" && (
                      <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">استيراد</span>
                    )}
                  </div>
                </div>
                {/* جسم الكارد */}
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black text-slate-900 dark:text-white">{tx.beneficiary.name}</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-400 dark:text-slate-500">بطاقة: {tx.beneficiary.card_number}</p>
                    {session.is_admin && (
                      <p className="mt-1 text-xs font-bold text-primary dark:text-blue-400">{tx.facility.name}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white">{Number(tx.amount).toLocaleString("ar-LY")}</p>
                    <p className="text-xs font-medium text-slate-400 dark:text-slate-500">دينار ليبي</p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* ══ عرض الجدول — شاشة كبيرة فقط ══ */}
        <form action={bulkTransactionSelectionAction} className="hidden sm:block">
          <Card className="overflow-hidden pb-0">
            {(session.is_admin || canCancel || canDelete) && (
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3 sm:px-6">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 text-nowrap">يمكنك تحديد أكثر من حركة ثم تنفيذ الإجراء الجماعي المتاح.</p>
                <div className="flex-1" />
                <BulkTransactionActionButton
                  statusFilter={statusFilter}
                  canCancel={canCancel || session.is_admin}
                  canDelete={canDelete || session.is_admin}
                />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    {(session.is_admin || canCancel || canDelete) && (
                      <th className="px-4 py-4 text-xs font-black text-slate-400 dark:text-slate-500">
                        <SelectAllTransactionsCheckbox />
                      </th>
                    )}
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500">#</th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500">
                      <Link href={txSortHref("beneficiary_name")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        المستفيد {sortCol === "beneficiary_name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                    </th>
                    {session.is_admin && (
                      <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500">
                        <Link href={txSortHref("facility_name")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                          المرفق {sortCol === "facility_name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                        </Link>
                      </th>
                    )}
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500">النوع</th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-right">
                      <Link href={txSortHref("amount")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        القيمة المخصومة {sortCol === "amount" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-right">
                      <Link href={txSortHref("remaining_balance")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        الرصيد المتبقي {sortCol === "remaining_balance" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-right">
                      <Link href={txSortHref("created_at")} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        التاريخ {sortCol === "created_at" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-center">الحالة</th>
                    {session.is_admin && <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-center">المصدر</th>}
                    {(session.is_admin || canCorrect) && <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 no-print">تعديل</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {transactionRows.length === 0 ? (
                    <tr>
                      <td colSpan={session.is_admin ? 12 : 8} className="px-6 py-10 text-center italic text-slate-500 dark:text-slate-400">لا توجد نتائج مطابقة للفلاتر الحالية.</td>
                    </tr>
                  ) : (
                    transactionRows.map((tx: TransactionRow, idx: number) => (
                      <tr key={tx.id} className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${tx.is_cancelled ? "bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20" : ""} ${tx.type === "CANCELLATION" ? "bg-green-50/50 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20" : ""}`}>
                        {(session.is_admin || canCancel || canDelete) && (
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              name="ids"
                              value={tx.id}
                              data-bulk-tx-checkbox="1"
                              data-tx-type={tx.type}
                              disabled={
                                tx.is_cancelled && (tx.corrections.length > 0 || statusFilter !== "deleted")
                              }
                              title={
                                tx.is_cancelled && (tx.corrections.length > 0 || statusFilter !== "deleted")
                                  ? "هذه الحركة غير قابلة للإجراء الجماعي"
                                  : "تحديد الحركة"
                              }
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                        )}
                        <td className="px-6 py-4 font-mono text-xs text-slate-500 dark:text-slate-400 font-bold">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                        <td className="px-6 py-4">
                          <p className="font-bold text-slate-900 dark:text-white">{tx.beneficiary.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{tx.beneficiary.card_number}</p>
                        </td>
                        {session.is_admin && (
                          <td className="px-6 py-4 text-sm font-medium text-slate-600 dark:text-slate-300">
                            {tx.facility.name}
                          </td>
                        )}
                        <td className="px-6 py-4">
                          {tx.type === "CANCELLATION" ? (
                            <Badge variant="success">إلغاء حركة</Badge>
                          ) : tx.type === "IMPORT" ? (
                            <Badge variant={session.is_admin ? "default" : "default"}>
                              {session.is_admin ? "استيراد" : "ادوية صرف عام"}
                            </Badge>
                          ) : (
                            <Badge variant={tx.type === "MEDICINE" ? "default" : "warning"}>
                              {tx.type === "MEDICINE" ? "ادوية صرف عام" : "كشف عام"}
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {(() => {
                            if (tx.type === "CANCELLATION") {
                              return (
                                <div className="inline-flex flex-col items-end">
                                  <span className="font-black text-green-700 dark:text-green-400">
                                    +{Math.abs(Number(tx.amount)).toLocaleString("ar-LY")}
                                  </span>
                                </div>
                              );
                            }

                            if (tx.is_cancelled) {
                              return (
                                <div className="inline-flex flex-col items-end">
                                  <span className="font-black text-slate-600 dark:text-slate-300">
                                    {Number(tx.amount).toLocaleString("ar-LY")}
                                  </span>
                                </div>
                              );
                            }

                            return (
                              <span className="font-black text-slate-900 dark:text-white">{Number(tx.amount).toLocaleString("ar-LY")}</span>
                            );
                          })()}
                          <span className="mr-3 text-[10px] text-slate-400 dark:text-slate-500">د.ل</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {(() => {
                            const historicalBalance = historicalBalanceByTxId.get(tx.id);
                            const currentBalance = Number(tx.beneficiary.remaining_balance);
                            const shownBalance = typeof historicalBalance === "number" ? historicalBalance : currentBalance;

                            if (tx.type === "CANCELLATION") {
                              return (
                                <div className="inline-flex flex-col items-end">
                                  <span className="font-medium text-emerald-700 dark:text-emerald-400">{shownBalance.toLocaleString("ar-LY")}</span>
                                </div>
                              );
                            }

                            if (tx.is_cancelled && (tx.corrections.length > 0)) {
                              return (
                                <div className="inline-flex flex-col items-end">
                                  <span className="font-medium text-slate-700 dark:text-slate-300 line-through opacity-70">{shownBalance.toLocaleString("ar-LY")}</span>
                                </div>
                              );
                            }

                            return <span className="font-medium text-slate-700 dark:text-slate-300">{shownBalance.toLocaleString("ar-LY")}</span>;
                          })()}
                          <span className="mr-3 text-[10px] text-slate-400 dark:text-slate-500">د.ل</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <p className="text-sm text-slate-900 dark:text-slate-300">{new Date(tx.created_at).toLocaleDateString("en-GB")}</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {tx.is_cancelled ? (
                            tx.corrections.length > 0 ? (
                              <span className="font-bold text-red-600 dark:text-red-400 text-xs text-nowrap">ملغاة</span>
                            ) : (
                              <span className="font-bold text-slate-500 dark:text-slate-400 text-xs text-nowrap">محذوفة</span>
                            )
                          ) : tx.type === "CANCELLATION" ? (
                            <span className="font-bold text-green-600 dark:text-green-400 text-xs text-nowrap">حركة مصححة</span>
                          ) : (
                            <span className="font-bold text-slate-500 dark:text-slate-400 text-xs text-nowrap">منفذة</span>
                          )}
                        </td>
                        {session.is_admin && (
                          <td className="px-6 py-4 text-center">
                            {tx.type === "IMPORT" ? (
                              <span className="font-bold text-violet-600 dark:text-violet-400 text-xs text-nowrap">استيراد</span>
                            ) : tx.type === "CANCELLATION" ? (
                              <span className="font-bold text-slate-400 dark:text-slate-500 text-xs text-nowrap">—</span>
                            ) : (
                              <span className="font-bold text-sky-600 dark:text-sky-400 text-xs text-nowrap">يدوي</span>
                            )}
                          </td>
                        )}
                        {(session.is_admin || canCorrect) && (
                          <td className="px-6 py-4 text-center no-print">
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
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
                {transactionRows.length > 0 && (
                  <tfoot className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 font-black">
                    <tr>
                      <td colSpan={session.is_admin ? 6 : 3} className="px-6 py-4 text-left text-slate-900 dark:text-white">الإجمالي الكلي</td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-slate-900 dark:text-white">{Number(totalAmount).toLocaleString("ar-LY")}</span>
                        <span className="mr-3 text-[10px] text-slate-400 dark:text-slate-500">د.ل</span>
                      </td>
                      <td colSpan={session.is_admin ? 5 : 3}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </form>
      </div>

      {/* ══ شريط الإحصائيات الثابت في أسفل الشاشة دائماً ══ */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm shadow-[0_-1px_8px_rgba(0,0,0,0.06)]">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 py-3">
            {/* إحصائيات */}
            <div className="flex items-center gap-5 text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                الإجمالي:{" "}
                <strong className="font-black text-slate-900 dark:text-white">
                  {totalCount.toLocaleString("ar-LY")}
                </strong>{" "}
                عملية
              </span>
              {totalPages > 1 && (
                <span className="hidden sm:inline text-slate-400 dark:text-slate-500">
                  صفحة <strong className="text-slate-700 dark:text-slate-300">{page}</strong> من{" "}
                  <strong className="text-slate-700 dark:text-slate-300">{totalPages}</strong>
                </span>
              )}
            </div>

            {/* أزرار التنقل */}
            <div className="flex gap-2">
              <PaginationButtons page={page} totalPages={totalPages} hrefForPage={txPageHref} />
            </div>
          </div>
        </div>
      </div>
      {sharedDatalist}
    </Shell>
  );
}
