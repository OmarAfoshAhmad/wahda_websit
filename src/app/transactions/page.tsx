import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Shell } from "@/components/shell";
import { getArabicSearchTerms } from "@/lib/search";
import { Card, Badge, Input, Button, DateInput } from "@/components/ui";
import { SmartPrintButton } from "@/components/smart-print-button";
import { ExportButton } from "@/components/export-button";
import { PaginationButtons } from "@/components/pagination-buttons";
import { bulkTransactionSelectionAction } from "@/app/actions/cancel-transaction";
import { BulkTransactionActionButton } from "@/components/admin";
import { SelectAllTransactionsCheckbox } from "@/components/select-all-transactions-checkbox";
import { TransactionEditModal } from "../../components/transaction-edit-modal";
import { TransactionCancelButton } from "@/components/transaction-cancel-button";
import { ImportSourceBadgeWithPanel } from "@/components/import-source-badge-with-panel";
import Link from "next/link";
import { FileInput, PlusCircle } from "lucide-react";
import { formatDateTripoli, formatTimeTripoli, getStartOfDayTripoli, getEndOfDayTripoli } from "@/lib/datetime";

type TransactionRow = {
  id: string;
  beneficiary_id: string;
  amount: Prisma.Decimal;
  type: string;
  is_cancelled: boolean;
  original_transaction_id: string | null;
  created_at: Date;
  corrections: Array<{
    id: string;
    amount: Prisma.Decimal;
    is_cancelled: boolean;
  }>;
  original_transaction: {
    id: string;
    amount: Prisma.Decimal;
    is_cancelled: boolean;
  } | null;
  beneficiary: {
    id: string;
    name: string;
    card_number: string;
    remaining_balance: Prisma.Decimal;
    total_balance: Prisma.Decimal;
    company_id?: string | null;
  };
  facility: {
    id: string;
    name: string;
  };
  company_id: string | null;
  service_category: string | null;
  actual_company_share: Prisma.Decimal | null;
  actual_patient_share: Prisma.Decimal | null;
  remaining_ceiling_after: Prisma.Decimal | null;
  consumed_before: Prisma.Decimal | null;
  consumed_after: Prisma.Decimal | null;
  policy_snapshot: any;
  calc_metadata: any;
  company: { id: string; name: string; code: string } | null;
};

function getMovementTypeLabel(txType: string): string {
  if (txType === "CANCELLATION") return "—";
  if (txType === "SETTLEMENT") return "تسوية";
  if (txType === "MEDICINE" || txType === "IMPORT") return "ادوية صرف عام";
  if (txType === "OPTICS") return "بصريات";
  return "كشف عام";
}

function getSourceType(txType: string): "import" | "manual" {
  return txType === "IMPORT" ? "import" : "manual";
}

function getTransactionStatusLabel(tx: TransactionRow): string {
  if (tx.is_cancelled) {
    return tx.corrections.length > 0 ? "ملغاة" : "محذوفة";
  }
  if (tx.type === "CANCELLATION") {
    return tx.original_transaction_id ? "حركة مصححة" : "حركة مصححة غير مرتبطة";
  }
  return "منفذة";
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ start_date?: string; end_date?: string; facility_id?: string; page?: string; pageSize?: string; q?: string; sort?: string; order?: string; status?: string; source?: string; focus_tx?: string; tx_type?: string; company_id?: string }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "view_transactions")) redirect("/dashboard");

  const { start_date, end_date, facility_id, page: pageParam, pageSize: pageSizeParam, q, sort, order, status: _status, tx_type, source, focus_tx, company_id: companyIdParam } = await searchParams;
  const allowedPageSizes = [10, 25, 50, 100, 200, 500, 1000];
  const requestedPageSize = parseInt(pageSizeParam ?? "10", 10);
  const PAGE_SIZE = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 10;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const facilities: Array<{ id: string; name: string }> = session.is_admin
    ? await prisma.facility.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [{ id: session.id, name: session.name }];

  // جلب الشركات للفلتر والـ badge
  const allCompanies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  const companyFilterId = (companyIdParam ?? "").trim();

  // ألوان ثابتة لكل شركة بناءً على ترتيبها
  const COMPANY_COLORS = [
    { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" }, // أزرق
    { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0" }, // أخضر
    { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA" }, // برتقالي
    { bg: "#FDF4FF", text: "#7E22CE", border: "#E9D5FF" }, // بنفسجي
    { bg: "#FFF1F2", text: "#BE123C", border: "#FECDD3" }, // أحمر
    { bg: "#F0FDFA", text: "#0F766E", border: "#99F6E4" }, // تيل
    { bg: "#FEFCE8", text: "#A16207", border: "#FEF08A" }, // أصفر
    { bg: "#F8FAFC", text: "#475569", border: "#CBD5E1" }, // رمادي
  ];
  const companyColorMap = new Map<string, typeof COMPANY_COLORS[number]>();
  allCompanies.forEach((c, i) => {
    companyColorMap.set(c.id, COMPANY_COLORS[i % COMPANY_COLORS.length]);
  });

  const rawFacilityFilter = (facility_id ?? "").trim();
  const selectedFacility = facilities.find((f) => f.id === rawFacilityFilter || f.name === rawFacilityFilter);
  const resolvedFacilityId = session.is_admin ? selectedFacility?.id : session.id;
  const facilityFilterInputValue = session.is_admin
    ? (selectedFacility?.name ?? rawFacilityFilter)
    : session.name;

  const ALLOWED_STATUSES = ["all", "active", "deleted"] as const;
  type TxStatus = typeof ALLOWED_STATUSES[number];
  const statusFilter: TxStatus = (ALLOWED_STATUSES as ReadonlyArray<string>).includes(_status ?? "") ? _status as TxStatus : "active";

  const allowedTxTypes = ["all", "supplies", "medicine"] as const;
  const txTypeFilter = allowedTxTypes.includes(tx_type as any) ? (tx_type as string) : "all";

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
    if (focus_tx) p.set("focus_tx", focus_tx);
    p.set("status", statusFilter);
    if (txTypeFilter !== "all") p.set("tx_type", txTypeFilter);
    if (sourceFilter !== "all") p.set("source", sourceFilter);
    if (companyFilterId) p.set("company_id", companyFilterId);
    p.set("pageSize", String(PAGE_SIZE));
    p.set("order", sortDir);
    Object.entries(overrides).forEach(([k, v]) => {
      if (v === "") {
        p.delete(k);
      } else {
        p.set(k, v);
      }
    });
    return p.toString();
  };

  const txSortHref = (col: string) => {
    return `/transactions?${buildTxParams({ sort: col, order: sortCol === col && sortDir === "asc" ? "desc" : "asc" })}`;
  };

  const txPageHref = (p: number) => {
    return `/transactions?${buildTxParams({ page: String(p) })}`;
  };

  // كل مرفق يرى حركاته فقط — المشرف يرى الكل ويمكنه الفلترة
  const where: Prisma.TransactionWhereInput = session.is_admin
    ? (resolvedFacilityId ? { facility_id: resolvedFacilityId } : {})
    : { facility_id: session.id };

  if (session.is_employee) {
    // الموظف: يرى فقط حركات الكاش التي نفذها حسابه، بدون الملغاة أو حركات التصحيح.
    where.type = { notIn: ["CANCELLATION", "SETTLEMENT"] };
    where.is_cancelled = false;
    where.idempotency_key = { startsWith: "cash-claim:" };
  } else {
    // بناءً على حالة statusFilter
    if (statusFilter === "active") {
      where.is_cancelled = false;
    } else if (statusFilter === "deleted") {
      where.is_cancelled = true;
    }
    // "all" doesn't add any condition on is_cancelled
  }

  const canViewSettlement = session.is_admin || session.is_manager;
  if (!canViewSettlement) {
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existingAnd, { type: { not: "SETTLEMENT" } }];
  }

  //  المصدر (يدوي / استيراد) — المبرمج فقط
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
      where.type = { in: ["MEDICINE", "SUPPLIES", "SETTLEMENT"] };
    }
  }

  // نوع الحركة — استبعاد الأسنان دائماً (تُعرض في بوابة خدمات الأسنان المنفصلة)
  // وقصر المعروض هنا فقط على موظفي مصرف الوحدة والحركات العامة بدون شركة
  const existingAndBase = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [
    ...existingAndBase,
    { type: { not: "DENTAL" as any } },
    {
      OR: [
        { company_id: "cmp7ha2km0000u9v8jse4ib5x" },
        { company_id: null }
      ]
    }
  ];

  if (txTypeFilter === "supplies") {
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existingAnd, { type: "SUPPLIES" }];
  } else if (txTypeFilter === "medicine") {
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existingAnd, { type: { in: ["MEDICINE", "IMPORT"] } }];
  }

  // فلترة حسب شركة التأمين
  if (companyFilterId) {
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existingAnd, { company_id: companyFilterId }];
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
  const hasDateFilter = !!(start_date || end_date);
  if (hasDateFilter) {
    where.created_at = {};
    if (start_date) {
      const start = getStartOfDayTripoli(start_date);
      if (!isNaN(start.getTime())) {
        where.created_at.gte = start;
      }
    }
    if (end_date) {
      const end = getEndOfDayTripoli(end_date);
      if (!isNaN(end.getTime())) {
        where.created_at.lte = end;
      }
    }
  }

  const [transactions, totalCount, totals, focusedTransaction] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: txOrderByMap[sortCol],
      select: {
        id: true,
        beneficiary_id: true,
        amount: true,
        type: true,
        is_cancelled: true,
        original_transaction_id: true,
        created_at: true,
        corrections: {
          where: { type: "CANCELLATION", is_cancelled: false },
          select: { id: true, amount: true, is_cancelled: true },
          take: 1,
        },
        original_transaction: {
          select: { id: true, amount: true, is_cancelled: true },
        },
        actual_company_share: true,
        actual_patient_share: true,
        remaining_ceiling_after: true,
        consumed_before: true,
        consumed_after: true,
        policy_snapshot: true,
        calc_metadata: true,
        service_category: true,
        company_id: true,
        company: { select: { id: true, name: true, code: true } },
        beneficiary: {
          select: { id: true, name: true, card_number: true, remaining_balance: true, total_balance: true, company_id: true },
        },
        facility: { select: { id: true, name: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({
      where: {
        facility_id: where.facility_id,
        AND: where.AND,
        type: where.type,
        created_at: where.created_at,
        is_cancelled: false,
      },
      _sum: { amount: true },
    }),
    focus_tx
      ? prisma.transaction.findFirst({
        where: { id: focus_tx },
        select: {
          id: true,
          beneficiary_id: true,
          amount: true,
          type: true,
          is_cancelled: true,
          original_transaction_id: true,
          created_at: true,
          corrections: {
            where: { type: "CANCELLATION", is_cancelled: false },
            select: { id: true, amount: true, is_cancelled: true },
            take: 1,
          },
          original_transaction: {
            select: { id: true, amount: true, is_cancelled: true },
          },
          beneficiary: { select: { id: true, name: true, card_number: true, remaining_balance: true, company_id: true } },
          facility: { select: { id: true, name: true } },
          company_id: true,
          service_category: true,
          actual_company_share: true,
          actual_patient_share: true,
          remaining_ceiling_after: true,
          company: { select: { id: true, name: true, code: true } },
        },
      })
      : Promise.resolve(null),
  ]);

  const transactionRowsBase = transactions as TransactionRow[];
  const focusedRow = focusedTransaction as TransactionRow | null;
  const transactionRows = focusedRow
    ? [focusedRow, ...transactionRowsBase.filter((tx) => tx.id !== focusedRow.id)].slice(0, PAGE_SIZE)
    : transactionRowsBase;

  // حساب الرصيد بعد كل حركة (لحظة تنفيذها) بدل عرض الرصيد الحالي فقط.
  // هذا يجعل عمود "الرصيد المتبقي" أدق تاريخيًا لكل صف.
  const txIdsForBalance = transactionRows.map((tx) => tx.id);
  const txRemainingRows = txIdsForBalance.length > 0
    ? await prisma.$queryRaw<Array<{ id: string; remaining_after: number }>>`
        SELECT
          t.id,
          GREATEST(
            0,
            b.total_balance::float8 - COALESCE(used.used_amount, 0)
          ) AS remaining_after
        FROM "Transaction" t
        JOIN "Beneficiary" b ON b.id = t.beneficiary_id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(t2.amount), 0)::float8 AS used_amount
          FROM "Transaction" t2
          WHERE t2.beneficiary_id = t.beneficiary_id
            AND t2.is_cancelled = false
            AND t2.type <> 'CANCELLATION'
            AND t2.created_at <= t.created_at
        ) used ON true
        WHERE t.id = ANY(${txIdsForBalance}::text[])
      `
    : [];

  const remainingAfterByTxId = new Map(
    txRemainingRows.map((row) => [row.id, Number(row.remaining_after) || 0]),
  );
  // حماية إضافية: لا نعرض إلا الحركات الفعلية حتى لو وصلتنا بيانات غير متوقعة.
  // بيانات التقرير (طباعة): نظهر الحركات حسب رغبة المستخدم، بما في ذلك الملغاة إذا كانت في الصفحة.
  const reportRowsCount = totalCount;
  const reportTotalAmount = Number(totals._sum.amount ?? 0);

  // إذا كانت الحركات تتبع مستفيداً واحداً، نستخدم رصيده الحالي في التقرير.
  const isSingleBeneficiary = transactionRows.length > 0 && transactionRows.every(t => t.beneficiary_id === transactionRows[0].beneficiary_id);
  const reportTotalRemaining = isSingleBeneficiary ? Number(transactionRows[0].beneficiary.remaining_balance) : 0;

  const isReadOnlyEmployee = session.is_employee;
  const canCancel = !isReadOnlyEmployee && hasPermission(session, "cancel_transactions");
  const canCorrect = !isReadOnlyEmployee && hasPermission(session, "correct_transactions");
  const canEditTransaction = !isReadOnlyEmployee && hasPermission(session, "edit_transaction");
  const canDelete = !isReadOnlyEmployee && hasPermission(session, "delete_transaction");
  const canAddManual = session.role !== "FACILITY" && (session.is_admin || hasPermission(session, "add_manual_transaction"));
  const canSingleAction = session.is_admin || canCancel || canCorrect;
  const canExport = session.is_admin || hasPermission(session, "export_data");
  const canImport = !isReadOnlyEmployee && (session.is_admin || ((session.manager_permissions as Partial<Record<string, boolean>> | null)?.import_transactions === true));
  const tableColSpan =
    5 + // 3 original + 2 new TPA columns (removed #, status, patient share, invoice amount, and company name)
    ((session.is_admin || canCancel || canDelete) ? 1 : 0) +
    (session.is_admin ? 1 : 0) +
    (session.is_admin ? 1 : 0) +
    ((session.is_admin || canCorrect || canCancel || canEditTransaction) ? 1 : 0);

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
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4 landscape; margin: 1cm; }
        }
      ` }} />
      <div id="printable-report" className="space-y-4 pb-20">

        {/* Print-only header */}
        <div className="hidden print:flex flex-col items-center justify-center mb-2 text-center border-b pb-2 pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Waha Health Care" className="h-16 w-auto object-contain mb-2" />
          <h1 className="text-xl font-black text-black">Waha Health Care</h1>
          <h2 className="text-lg font-bold text-black mt-1">سجل الحركات (المراجعة الطبية)</h2>
          <p className="text-sm font-bold text-black mt-1">الفترة الزمنية: {start_date ? `من ${start_date}` : "من البداية"} - {end_date ? `إلى ${end_date}` : "إلى الآن"}</p>
          <p className="text-sm text-black mt-1 opacity-75">تاريخ استخراج التقرير: {formatDateTripoli(new Date(), "en-GB")}</p>
          {session.is_admin && resolvedFacilityId && <p className="text-sm font-bold mt-1 text-black">خاص بالمرفق: {selectedFacility?.name}</p>}
        </div>

        <div className="hidden print:grid grid-cols-3 gap-3 border-b border-black/40 pb-3 mb-3 text-black">
          <div className="text-center">
            <p className="text-xs">إجمالي عدد الحركات (حسب الفلتر)</p>
            <p className="text-lg font-black">{reportRowsCount.toLocaleString("ar-LY")}</p>
          </div>
          <div className="text-center">
            <p className="text-xs">إجمالي المخصوم</p>
            <p className="text-lg font-black">{reportTotalAmount.toLocaleString("ar-LY")} د.ل</p>
          </div>
          <div className="text-center">
            <p className="text-xs">{isSingleBeneficiary ? "الرصيد الحالي للمستفيد" : "—"}</p>
            <p className="text-lg font-black">{isSingleBeneficiary ? reportTotalRemaining.toLocaleString("ar-LY") + " د.ل" : "—"}</p>
          </div>
        </div>

        <div className="print:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-black text-slate-900 dark:text-white sm:text-2xl">سجل الحركات (المراجعة الطبية)</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {hasDateFilter ? "نتائج مفلترة بالتاريخ" : "عرض كافة الحركات من البداية"}
              </p>
            </div>
            {/* أزرار الرأس — أيقونات فقط على الجوال، نص كامل على الشاشات الكبيرة */}
            <div className="no-print flex shrink-0 items-center gap-1.5 sm:gap-2">
              {canAddManual && (
                <Link
                  href="/add-transaction"
                  title="إضافة حركة يدوية"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700 sm:w-auto sm:gap-1.5 sm:px-3"
                >
                  <PlusCircle className="h-4 w-4 shrink-0" />
                  <span className="hidden text-sm font-bold sm:inline">إضافة حركة يدوية</span>
                </Link>
              )}
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
              {canExport && (
                <ExportButton
                  searchParams={{
                    start_date,
                    end_date,
                    facility_id,
                    q,
                    page: String(page),
                    pageSize: String(PAGE_SIZE),
                    sort: sortCol,
                    order: sortDir,
                    status: statusFilter,
                    tx_type: txTypeFilter,
                    source: sourceFilter,
                    tx_ids: transactionRows.filter(tx => !tx.is_cancelled && tx.type !== "CANCELLATION").map((tx) => tx.id).join(","),
                  }}
                />
              )}
              <SmartPrintButton />
            </div>
          </div>
        </div>

        {/* ملخص التقرير */}
        {(start_date || end_date) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
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
          <input type="hidden" name="pageSize" value={String(PAGE_SIZE)} />
          <input type="hidden" name="start_date" value={start_date ?? ""} />
          <input type="hidden" name="end_date" value={end_date ?? ""} />
          <input type="hidden" name="facility_id" value={facility_id ?? ""} />
          {txTypeFilter !== "all" && <input type="hidden" name="tx_type" value={txTypeFilter} />}
          {sourceFilter !== "all" && <input type="hidden" name="source" value={sourceFilter} />}
          <div className="w-full">
            <label htmlFor="tx-search" className="block text-xs font-black text-slate-400 mb-1">بحث باسم المستفيد أو رقم البطاقة</label>
            <Input
              id="tx-search"
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
            <input type="hidden" name="pageSize" value={String(PAGE_SIZE)} />
            <input type="hidden" name="q" value={q ?? ""} />
            {companyFilterId && <input type="hidden" name="company_id" value={companyFilterId} />}

            <div className={`grid grid-cols-1 gap-4 ${session.is_admin ? "md:grid-cols-7" : "md:grid-cols-5"}`}>
              <div className="space-y-1">
                <label htmlFor="start_date" className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">من تاريخ</label>
                <DateInput name="start_date" defaultValue={start_date ?? undefined} className="[direction:ltr] text-right" />
              </div>
              <div className="space-y-1">
                <label htmlFor="end_date" className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">إلى تاريخ</label>
                <DateInput name="end_date" defaultValue={end_date ?? undefined} className="[direction:ltr] text-right" />
              </div>



              <div className="space-y-1">
                <label htmlFor="tx_type" className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">نوع الحركة</label>
                <select
                  id="tx_type"
                  name="tx_type"
                  defaultValue={txTypeFilter}
                  className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <option value="all">الكل</option>
                  <option value="supplies">كشف عام</option>
                  <option value="medicine">أدوية صرف عام</option>
                  {process.env.NEXT_PUBLIC_APP_MODE?.replace(/["']/g, '').toUpperCase() !== "WAHDA_ONLY" && (
                    <option value="dental">أسنان</option>
                  )}
                </select>
              </div>

              {session.is_admin && (
                <div className="space-y-1">
                  <label htmlFor="facility_id_input" className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">المرفق</label>
                  <Input
                    id="facility_id_input"
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
                  <label htmlFor="source" className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">المصدر</label>
                  <select
                    id="source"
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


              <div className="flex items-end gap-2">
                <button type="submit" className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-primary-dark whitespace-nowrap">
                  عرض التقرير
                </button>
                <Link href="/transactions" className="flex items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-black text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-slate-200" title="إعادة تعيين الفلاتر">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-rotate-ccw"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                </Link>
              </div>
            </div>
          </form>
        </Card>

        {/* ══ عرض الكارد — جوال فقط ══ */}
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form action={bulkTransactionSelectionAction as unknown as (formData: FormData) => void} className="flex flex-col gap-3 sm:hidden">
          {(session.is_admin || canCancel || canDelete) && transactionRows.length > 0 && (
            <Card className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">تحديد فردي أو جماعي للحركات</span>
                <div className="flex items-center gap-2">
                  <SelectAllTransactionsCheckbox />
                  <BulkTransactionActionButton
                    statusFilter={statusFilter}
                    canCancel={false}
                    canDelete={canDelete || session.is_admin}
                  />
                </div>
              </div>
            </Card>
          )}

          {transactionRows.length === 0 ? (
            <p className="py-10 text-center italic text-slate-500">لا توجد نتائج مطابقة للفلاتر الحالية.</p>
          ) : (
            transactionRows.map((tx: TransactionRow) => {
              const currentBalance = remainingAfterByTxId.get(tx.id) ?? Number(tx.beneficiary.remaining_balance);
              const amount = Number(tx.amount);
              const balanceBeforeDelete = currentBalance;
              const balanceAfterDelete = currentBalance + amount;

              return (
              <Card key={tx.id} className="overflow-hidden p-0">
                {/* رأس الكارد */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-800/30 px-4 py-2.5">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(tx.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Tripoli" })}
                    {" · "}
                    {formatTimeTripoli(tx.created_at, "ar-LY")}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant={tx.type === "MEDICINE" || tx.type === "IMPORT" ? "default" : "warning"}>
                      {tx.type === "MEDICINE" ? "ادوية صرف عام" : tx.type === "IMPORT" ? (session.is_admin ? "استيراد" : "ادوية صرف عام") : "كشف عام"}
                    </Badge>
                    {session.is_admin && tx.type === "IMPORT" && (
                      <ImportSourceBadgeWithPanel source="import" transactionId={tx.id} />
                    )}
                    {session.is_admin && tx.type !== "IMPORT" && tx.type !== "CANCELLATION" && (
                      <ImportSourceBadgeWithPanel source="manual" />
                    )}
                  </div>
                </div>
                {/* جسم الكارد */}
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black text-slate-900 dark:text-white">{tx.beneficiary.name}</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-400 dark:text-slate-500">بطاقة: {tx.beneficiary.card_number}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">نوع الحركة: {getMovementTypeLabel(tx.type)}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">الحالة: {getTransactionStatusLabel(tx)}</p>
                    {session.is_admin && (
                      <p className="mt-1 text-xs font-bold text-primary dark:text-blue-400">{tx.facility.name}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white">{Number(tx.amount).toLocaleString("ar-LY")}</p>
                    <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">دينار ليبي</p>
                    
                    <div className="mt-2 text-[10px] bg-slate-100 dark:bg-slate-800/80 px-2 py-1 rounded-md">
                      {(() => {
                        if (tx.remaining_ceiling_after != null) {
                          return (
                            <>
                              <p className="text-slate-400 font-bold mb-0.5">الرصيد المتبقي</p>
                              <p className="font-black text-emerald-600 dark:text-emerald-400">{Number(tx.remaining_ceiling_after).toLocaleString("ar-LY")} د.ل</p>
                            </>
                          );
                        }

                        const shownBalance = remainingAfterByTxId.get(tx.id) ?? Number(tx.beneficiary.remaining_balance);
                        return (
                          <>
                            <p className="text-slate-400 font-bold mb-0.5">الرصيد المتبقي</p>
                            <p className="font-black text-emerald-600 dark:text-emerald-400">{shownBalance.toLocaleString("ar-LY")} د.ل</p>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {(session.is_admin || canCancel || canDelete || canSingleAction) && (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800/70 px-4 py-2.5">
                    {(session.is_admin || canCancel || canDelete) && (
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                        <input
                          type="checkbox"
                          name="ids"
                          value={tx.id}
                          data-bulk-tx-checkbox="1"
                          data-tx-type={tx.type}
                          data-original-transaction-id={tx.original_transaction_id ?? ""}
                          data-beneficiary-name={tx.beneficiary.name}
                          data-balance-before-delete={String(balanceBeforeDelete)}
                          data-amount={String(amount)}
                          data-balance-after-delete={String(balanceAfterDelete)}
                          disabled={tx.is_cancelled && tx.corrections.length > 0}
                          title={
                            tx.is_cancelled && tx.corrections.length > 0
                              ? "هذه الحركة غير قابلة للإجراء الجماعي"
                              : "تحديد الحركة"
                          }
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
                        />
                        تحديد
                      </label>
                    )}

                    {/* {canSingleAction && (
                      <div className="mr-auto">
                        <TransactionCancelButton
                          transactionId={tx.id}
                          isCancelled={tx.is_cancelled}
                          type={tx.type}
                        />
                      </div>
                    )} */}
                  </div>
                )}
              </Card>
            );
            })
          )}
        </form>

        {/* ══ عرض الجدول — شاشة كبيرة فقط ══ */}
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form action={bulkTransactionSelectionAction as unknown as (formData: FormData) => void} className="hidden sm:block">
          <Card className="overflow-hidden pb-0">
            {(session.is_admin || canCancel || canDelete) && (
              <div className="print:hidden flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-3 sm:px-6">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 text-nowrap">يمكنك تحديد أكثر من حركة ثم تنفيذ الإجراء الجماعي المتاح.</p>
                <div className="flex-1" />
                <BulkTransactionActionButton
                  statusFilter={statusFilter}
                  canCancel={false}
                  canDelete={canDelete || session.is_admin}
                />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    {(session.is_admin || canCancel || canDelete) && (
                      <th className="print:hidden px-4 py-4 text-xs font-black text-slate-400 dark:text-slate-500">
                        <SelectAllTransactionsCheckbox />
                      </th>
                    )}

                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500">
                      <Link href={txSortHref("beneficiary_name")} className="print:hidden inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        المستفيد {sortCol === "beneficiary_name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                      <span className="hidden print:inline">المستفيد</span>
                    </th>
                    {session.is_admin && (
                      <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500">
                        <Link href={txSortHref("facility_name")} className="print:hidden inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                          المرفق {sortCol === "facility_name" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                        </Link>
                        <span className="hidden print:inline">المرفق</span>
                      </th>
                    )}
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500">نوع الحركة</th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-center">القيمة المخصومة</th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-center">
                      <Link href={txSortHref("remaining_balance")} className="print:hidden inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        الرصيد المتبقي {sortCol === "remaining_balance" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                      <span className="hidden print:inline">الرصيد المتبقي</span>
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-center">
                      <Link href={txSortHref("created_at")} className="print:hidden inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                        التاريخ {sortCol === "created_at" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                      </Link>
                      <span className="hidden print:inline">التاريخ</span>
                    </th>

                    {session.is_admin && <th className="print:hidden px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 text-center">المصدر</th>}
                    {(session.is_admin || canCorrect || canCancel || canEditTransaction) && <th className="px-6 py-4 text-xs font-black text-slate-400 dark:text-slate-500 no-print">إجراءات</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {transactionRows.length === 0 ? (
                    <tr>
                      <td colSpan={tableColSpan} className="px-6 py-10 text-center italic text-slate-500 dark:text-slate-400">لا توجد نتائج مطابقة للفلاتر الحالية.</td>
                    </tr>
                  ) : (
                    transactionRows.map((tx: TransactionRow) => (
                      (() => {
                        const currentBalance = remainingAfterByTxId.get(tx.id) ?? Number(tx.beneficiary.remaining_balance);
                        const amount = Number(tx.amount);
                        const balanceBeforeDelete = currentBalance;
                        const balanceAfterDelete = currentBalance + amount;

                        return (
                      <tr key={tx.id} className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${tx.is_cancelled ? "bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20" : ""} ${tx.type === "CANCELLATION" ? "bg-green-50/50 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20" : ""}`}>
                        {(session.is_admin || canCancel || canDelete) && (
                          <td className="print:hidden px-4 py-4">
                            <input
                              type="checkbox"
                              name="ids"
                              value={tx.id}
                              data-bulk-tx-checkbox="1"
                              data-tx-type={tx.type}
                              data-original-transaction-id={tx.original_transaction_id ?? ""}
                              data-beneficiary-name={tx.beneficiary.name}
                              data-balance-before-delete={String(balanceBeforeDelete)}
                              data-amount={String(amount)}
                              data-balance-after-delete={String(balanceAfterDelete)}
                              disabled={tx.is_cancelled && tx.corrections.length > 0}
                              title={
                                tx.is_cancelled && tx.corrections.length > 0
                                  ? "هذه الحركة غير قابلة للإجراء الجماعي"
                                  : "تحديد الحركة"
                              }
                              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                        )}

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
                            <Badge variant="success">—</Badge>
                          ) : (
                            <Badge variant={tx.type === "MEDICINE" || tx.type === "IMPORT" ? "default" : "warning"}>
                              {getMovementTypeLabel(tx.type)}
                            </Badge>
                          )}
                        </td>

                        <td className="px-6 py-4 text-center">
                          {(() => {
                            const deducted = tx.actual_company_share ? Number(tx.actual_company_share) : Number(tx.amount);
                            if (tx.type === "CANCELLATION") {
                              return (
                                <span className="font-black text-green-700 dark:text-green-400">
                                  +{Math.abs(deducted).toLocaleString("ar-LY")}
                                </span>
                              );
                            }
                            return (
                              <span className="font-black text-slate-900 dark:text-white">
                                {deducted.toLocaleString("ar-LY")}
                              </span>
                            );
                          })()}
                          <span className="mr-2 text-[10px] text-slate-400 dark:text-slate-500">د.ل</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {(() => {
                            if (tx.remaining_ceiling_after != null) {
                              return <span className="font-medium text-slate-700 dark:text-slate-300">{Number(tx.remaining_ceiling_after).toLocaleString("ar-LY")}</span>;
                            }

                            const shownBalance = remainingAfterByTxId.get(tx.id) ?? Number(tx.beneficiary.remaining_balance);

                            if (tx.type === "CANCELLATION") {
                              return (
                                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                                  {shownBalance.toLocaleString("ar-LY")}
                                </span>
                              );
                            }

                            if (tx.is_cancelled && (tx.corrections.length > 0)) {
                              return (
                                <span className="font-medium text-slate-700 dark:text-slate-300 line-through opacity-70">
                                  {shownBalance.toLocaleString("ar-LY")}
                                </span>
                              );
                            }

                            return (
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                {shownBalance.toLocaleString("ar-LY")}
                              </span>
                            );
                          })()}
                          <span className="mr-2 text-[10px] text-slate-400 dark:text-slate-500 font-bold">د.ل</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <p className="text-sm text-slate-900 dark:text-slate-300">{formatDateTripoli(tx.created_at, "en-GB")}</p>
                        </td>

                        {session.is_admin && (
                          <td className="print:hidden px-6 py-4 text-center">
                            {tx.type === "CANCELLATION" ? (
                              <span className="font-bold text-slate-500 dark:text-slate-400 text-xs text-nowrap">—</span>
                            ) : (
                              <ImportSourceBadgeWithPanel source={getSourceType(tx.type)} transactionId={tx.id} />
                            )}
                          </td>
                        )}
                        {(session.is_admin || canCorrect || canCancel || canEditTransaction) && (
                          <td className="px-6 py-4 text-center no-print">
                            <div className="flex items-center justify-center gap-2">
                              {/* {canSingleAction && (
                                <TransactionCancelButton
                                  transactionId={tx.id}
                                  isCancelled={tx.is_cancelled}
                                  type={tx.type}
                                />
                              )} */}
                              {(session.is_admin || canEditTransaction) && (
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
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                        );
                      })()
                    ))
                  )}
                </tbody>
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
              <form method="get" className="hidden sm:flex items-center gap-2">
                <input type="hidden" name="page" value="1" />
                <input type="hidden" name="start_date" value={start_date ?? ""} />
                <input type="hidden" name="end_date" value={end_date ?? ""} />
                <input type="hidden" name="facility_id" value={facility_id ?? ""} />
                <input type="hidden" name="q" value={q ?? ""} />
                <input type="hidden" name="sort" value={sortCol} />
                <input type="hidden" name="order" value={sortDir} />
                <input type="hidden" name="status" value={statusFilter} />
                {sourceFilter !== "all" && <input type="hidden" name="source" value={sourceFilter} />}
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400">عدد السجلات</label>
                <select
                  name="pageSize"
                  defaultValue={String(PAGE_SIZE)}
                  className="h-8 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-sm text-slate-900 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {allowedPageSizes.map((size) => (
                    <option key={size} value={String(size)}>{size}</option>
                  ))}
                </select>
              </form>
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
