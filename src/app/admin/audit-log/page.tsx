import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Input, Button } from "@/components/ui";
import { DateInput } from "@/components/date-input";
import { Shell } from "@/components/shell";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Activity, Download } from "lucide-react";
// SEC-FIX: تم تعطيل زر حذف سجلات التدقيق — السجلات محمية ولا تقبل الحذف
// import { AuditLogClearButton } from "../../../components/audit-log-clear-button";
import { ImportRollbackButton } from "@/components/import-rollback-button";
import { TransactionRollbackButton } from "@/components/transaction-rollback-button";
import { formatDateTimeTripoli } from "@/lib/datetime";

type TargetFilter = "all" | "beneficiaries" | "transactions" | "facilities" | "completed";

const PAGE_SIZE = 30;

const TARGET_ACTIONS: Record<TargetFilter, string[]> = {
  all: [
    "CREATE_BENEFICIARY",
    "UPDATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
    "DEDUCT_BALANCE",
    "EDIT_TRANSACTION",
    "CANCEL_TRANSACTION",
    "REVERT_CANCELLATION",
    "SOFT_DELETE_TRANSACTION",
    "RESTORE_SOFT_DELETED_TRANSACTION",
    "PERMANENT_DELETE_TRANSACTION",
    "BULK_CANCEL_TRANSACTION",
    "BULK_REDEDUCT_TRANSACTION",
    "IMPORT_TRANSACTIONS",
    "CREATE_FACILITY",
    "IMPORT_FACILITIES",
    "DELETE_FACILITY",
    "ROLLBACK_IMPORT",
  ],
  beneficiaries: [
    "CREATE_BENEFICIARY",
    "UPDATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "ROLLBACK_IMPORT",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
  ],
  transactions: [
    "DEDUCT_BALANCE",
    "EDIT_TRANSACTION",
    "CANCEL_TRANSACTION",
    "REVERT_CANCELLATION",
    "SOFT_DELETE_TRANSACTION",
    "RESTORE_SOFT_DELETED_TRANSACTION",
    "PERMANENT_DELETE_TRANSACTION",
    "BULK_CANCEL_TRANSACTION",
    "BULK_REDEDUCT_TRANSACTION",
    "IMPORT_TRANSACTIONS",
  ],
  facilities: ["CREATE_FACILITY", "IMPORT_FACILITIES", "DELETE_FACILITY"],
  completed: ["DEDUCT_BALANCE", "IMPORT_TRANSACTIONS"],
};

function actionLabel(action: string) {
  switch (action) {
    case "CREATE_BENEFICIARY":
      return "إضافة مستفيد";
    case "IMPORT_BENEFICIARIES_BACKGROUND":
      return "استيراد مستفيدين";
    case "UPDATE_BENEFICIARY":
      return "تعديل مستفيد";
    case "DELETE_BENEFICIARY":
      return "حذف مستفيد";
    case "PERMANENT_DELETE_BENEFICIARY":
      return "حذف نهائي لمستفيد";
    case "RESTORE_BENEFICIARY":
      return "استرجاع مستفيد";
    case "DEDUCT_BALANCE":
      return "إضافة حركة خصم";
    case "EDIT_TRANSACTION":
      return "تعديل حركة";
    case "CANCEL_TRANSACTION":
      return "حذف/إلغاء حركة";
    case "REVERT_CANCELLATION":
      return "استرجاع حركة ملغاة";
    case "SOFT_DELETE_TRANSACTION":
      return "حذف ناعم لحركة";
    case "RESTORE_SOFT_DELETED_TRANSACTION":
      return "استرجاع حركة محذوفة ناعماً";
    case "PERMANENT_DELETE_TRANSACTION":
      return "حذف نهائي لحركات";
    case "BULK_CANCEL_TRANSACTION":
      return "إلغاء جماعي لحركات";
    case "BULK_REDEDUCT_TRANSACTION":
      return "إعادة خصم جماعي";
    case "IMPORT_TRANSACTIONS":
      return "استيراد حركات";
    case "CREATE_FACILITY":
      return "إضافة مرفق";
    case "IMPORT_FACILITIES":
      return "استيراد مرافق";
    case "DELETE_FACILITY":
      return "حذف مرفق";
    case "ROLLBACK_IMPORT":
      return "تراجع عن استيراد";
    default:
      return action;
  }
}

function getMetadataValue(
  metadata: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== "") {
      return metadata[key];
    }
  }
  return "-";
}

type AuditRenderLookups = {
  txBeneficiaryById: Map<string, { name: string; cardNumber: string }>;
};

function summarizeMetadata(action: string, metadata: unknown, auditLogId?: string, lookups?: AuditRenderLookups): React.ReactNode {
  if (!metadata || typeof metadata !== "object") return "-";
  const m = metadata as Record<string, unknown>;
  const balanceBefore = getMetadataValue(m, "balance_before", "balanceBefore", "before_balance");
  const balanceAfter = getMetadataValue(m, "balance_after", "balanceAfter", "after_balance");

  if (action === "CREATE_BENEFICIARY") {
    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{String(m.card_number ?? "-")}</span>
        {m.beneficiary_name ? <span className="mr-1.5 text-slate-500 dark:text-slate-400">— {String(m.beneficiary_name)}</span> : null}
      </span>
    );
  }

  if (action === "UPDATE_BENEFICIARY") {
    const beneficiaryName = getMetadataValue(m, "beneficiary_name", "new_name", "old_name");
    const oldRemaining = getMetadataValue(m, "old_remaining_balance");
    const newRemaining = getMetadataValue(m, "new_remaining_balance");
    const spentAtEdit = getMetadataValue(m, "spent_amount_at_edit");
    const showRemainingChange = oldRemaining !== "-" || newRemaining !== "-";

    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{String(beneficiaryName)}</span>
        <span className="mr-1.5 text-slate-500 dark:text-slate-400">— بطاقة: {String(m.card_number ?? "-")}</span>
        <span className="mr-1.5 text-xs text-slate-400 dark:text-slate-500">(تعديل بيانات)</span>
        {showRemainingChange ? (
          <>
            <span className="mr-2 text-slate-500 dark:text-slate-400">· الرصيد المتبقي: {String(oldRemaining)} ← {String(newRemaining)} د.ل</span>
            <span className="mr-1.5 text-xs text-slate-400 dark:text-slate-500">(المصروف وقت التعديل: {String(spentAtEdit)} د.ل)</span>
          </>
        ) : null}
      </span>
    );
  }

  if (action === "DELETE_BENEFICIARY" || action === "PERMANENT_DELETE_BENEFICIARY" || action === "RESTORE_BENEFICIARY") {
    const label = action === "DELETE_BENEFICIARY" ? "حذف" : action === "PERMANENT_DELETE_BENEFICIARY" ? "حذف نهائي" : "استرجاع";
    const name = String(m.beneficiary_name ?? m.beneficiary_id ?? "-");
    const card = m.card_number ? ` · بطاقة: ${String(m.card_number)}` : "";
    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{name}</span>
        <span className="mr-1.5 text-xs text-slate-400 dark:text-slate-500">({label}{card})</span>
      </span>
    );
  }

  if (action === "DEDUCT_BALANCE") {
    const name = m.beneficiary_name ? String(m.beneficiary_name) : null;
    const completed = m.beneficiary_completed ? true : false;
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {name && <span className="font-bold text-slate-800 dark:text-slate-200">{name}</span>}
        <span className="text-slate-500 dark:text-slate-400">بطاقة: {String(m.card_number ?? "-")}</span>
        <span className="text-slate-500 dark:text-slate-400">مبلغ: {String(m.amount ?? "-")} د.ل</span>
        <span className="text-slate-500 dark:text-slate-400">قبل: {String(balanceBefore)} د.ل</span>
        <span className="text-slate-500 dark:text-slate-400">بعد: {String(balanceAfter)} د.ل</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">({String(m.type === "MEDICINE" ? "دواء" : m.type === "SUPPLIES" ? "مستلزمات" : String(m.type ?? "-"))})</span>
        {completed && (
          <span className="inline-flex items-center rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
            اكتمل الرصيد ✓
          </span>
        )}
      </span>
    );
  }

  if (action === "EDIT_TRANSACTION") {
    const transactionId = getMetadataValue(m, "transaction_id");
    const txLookup = typeof transactionId === "string" ? lookups?.txBeneficiaryById.get(transactionId) : undefined;
    const oldBeforeDeduction = getMetadataValue(m, "old_balance_before_deduction", "balance_before");
    const oldDeducted = getMetadataValue(m, "old_deducted_amount", "old_amount");
    const oldRemaining = getMetadataValue(m, "old_remaining_after_deduction", "balance_before");
    const newBeforeDeduction = getMetadataValue(m, "new_balance_before_deduction", "balance_before");
    const newDeducted = getMetadataValue(m, "new_deducted_amount", "new_amount");
    const newRemaining = getMetadataValue(m, "new_remaining_after_deduction", "balance_after");
    const beneficiaryName = getMetadataValue(m, "beneficiary_name") !== "-"
      ? getMetadataValue(m, "beneficiary_name")
      : (txLookup?.name ?? "-");
    const cardNumber = getMetadataValue(m, "card_number") !== "-"
      ? getMetadataValue(m, "card_number")
      : (txLookup?.cardNumber ?? "-");

    return (
      <div className="space-y-2 text-right">
        <div className="text-slate-600 dark:text-slate-400">
          <div><span className="font-bold text-slate-800 dark:text-slate-200">{String(beneficiaryName)}</span></div>
          <div className="text-xs">بطاقة: {String(cardNumber)}</div>
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="px-2 py-1 text-right">البيان</th>
                <th className="px-2 py-1 text-right text-red-600 dark:text-red-400">قبل</th>
                <th className="px-2 py-1 text-right text-emerald-700 dark:text-emerald-400">بعد</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-2 py-1 font-semibold text-slate-600 dark:text-slate-300">قبل الخصم</td>
                <td className="px-2 py-1 font-bold text-red-600 dark:text-red-400">{String(oldBeforeDeduction)} د.ل</td>
                <td className="px-2 py-1 font-bold text-emerald-700 dark:text-emerald-400">{String(newBeforeDeduction)} د.ل</td>
              </tr>
              <tr>
                <td className="px-2 py-1 font-semibold text-slate-600 dark:text-slate-300">المخصوم</td>
                <td className="px-2 py-1 font-bold text-red-600 dark:text-red-400">{String(oldDeducted)} د.ل</td>
                <td className="px-2 py-1 font-bold text-emerald-700 dark:text-emerald-400">{String(newDeducted)} د.ل</td>
              </tr>
              <tr>
                <td className="px-2 py-1 font-semibold text-slate-600 dark:text-slate-300">المتبقي</td>
                <td className="px-2 py-1 font-bold text-red-600 dark:text-red-400">{String(oldRemaining)} د.ل</td>
                <td className="px-2 py-1 font-bold text-emerald-700 dark:text-emerald-400">{String(newRemaining)} د.ل</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (action === "IMPORT_BENEFICIARIES_BACKGROUND") {
    const jobId = m.jobId ? String(m.jobId) : null;
    const dupeCount = Number(m.duplicateRows ?? 0);
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
        <span>تمت إضافة: <strong className="text-slate-700 dark:text-slate-300">{String(m.insertedRows ?? "-")}</strong></span>
        <span>مكررة: <strong className="text-slate-700 dark:text-slate-300">{String(m.duplicateRows ?? "-")}</strong></span>
        {m.totalRows ? <span>الإجمالي: <strong className="text-slate-700 dark:text-slate-300">{String(m.totalRows)}</strong></span> : null}
        {jobId && (
          <a
            href={`/api/export/import-beneficiaries?jobId=${encodeURIComponent(jobId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
            title="تصدير تقرير المستفيدين المستوردين مع الأرصدة بصيغة Excel"
          >
            ↓ تقرير المستوردين
          </a>
        )}
        {jobId && dupeCount > 0 && (
          <a
            href={`/api/export/import-report?jobId=${encodeURIComponent(jobId)}`}
            className="inline-flex items-center gap-1 rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
            title="تصدير تقرير المكررين والمتخطين بصيغة Excel"
          >
            ↓ تقرير المكررين ({dupeCount})
          </a>
        )}
        {jobId && <ImportRollbackButton jobId={jobId} />}
      </span>
    );
  }

  if (action === "CANCEL_TRANSACTION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        مبلغ مرتجع: <strong className="text-slate-700 dark:text-slate-300">{String(m.refunded_amount ?? "-")} د.ل</strong>
        {m.card_number ? <span className="mr-1.5">· بطاقة: {String(m.card_number)}</span> : null}
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "REVERT_CANCELLATION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {m.card_number ? <span>بطاقة: {String(m.card_number)} · </span> : null}
        <span>إلغاء الإلغاء</span>
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "SOFT_DELETE_TRANSACTION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        مبلغ مرتجع: <strong className="text-slate-700 dark:text-slate-300">{String(m.refunded_amount ?? "-")} د.ل</strong>
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "RESTORE_SOFT_DELETED_TRANSACTION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        مبلغ مخصوم: <strong className="text-slate-700 dark:text-slate-300">{String(m.deducted_amount ?? "-")} د.ل</strong>
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "PERMANENT_DELETE_TRANSACTION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        تم حذف نهائي: <strong className="text-slate-700 dark:text-slate-300">{String(m.deleted_count ?? "-")}</strong>
        <span className="mr-1.5">· تأثير الرصيد: {String(m.balance_impact ?? 0)} د.ل</span>
      </span>
    );
  }

  if (action === "BULK_CANCEL_TRANSACTION" || action === "BULK_REDEDUCT_TRANSACTION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        مختارة: <strong className="text-slate-700 dark:text-slate-300">{String(m.selected_count ?? "-")}</strong>
        <span className="mr-1.5">· منفذة: {String(m.processed_count ?? "-")}</span>
        <span className="mr-1.5">· ناجحة: {String(m.cancelled_count ?? m.rededucted_count ?? "-")}</span>
        <span className="mr-1.5">· متخطاة: {String(m.skipped_count ?? "-")}</span>
      </span>
    );
  }

  if (action === "IMPORT_TRANSACTIONS") {
    const appliedRowsCount = Array.isArray(m.appliedRows) ? m.appliedRows.length : 0;
    const isRolledBack = Boolean(m.rolledBack);
    return (
      <span className="flex flex-wrap gap-x-2 text-slate-500 dark:text-slate-400">
        <span>عائلات: <strong className="text-slate-700 dark:text-slate-300">{String(m.importedFamilies ?? m.added ?? "-")}</strong></span>
        <span>حركات: <strong className="text-slate-700 dark:text-slate-300">{String(m.importedTransactions ?? "-")}</strong></span>
        {m.suspendedFamilies ? <span>موقوفة: <strong className="text-slate-700 dark:text-slate-300">{String(m.suspendedFamilies)}</strong></span> : null}
        {Number(m.balanceSetFamilies ?? 0) > 0 ? <span>أُعيد رصيدها: <strong className="text-blue-700 dark:text-blue-400">{String(m.balanceSetFamilies)}</strong></span> : null}
        {Number(m.skippedNotFound ?? 0) > 0 ? <span className="text-amber-600 dark:text-amber-400">غير موجودة: {String(m.skippedNotFound)}</span> : null}
        {Number(m.skippedAlreadyImported ?? 0) > 0 ? <span className="text-slate-400 dark:text-slate-500">مكررة: {String(m.skippedAlreadyImported)}</span> : null}
        {auditLogId && appliedRowsCount > 0 ? (
          <a
            href={`/api/export/audit-log?log_id=${encodeURIComponent(auditLogId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
            title="تصدير تقرير تفصيلي لهذه العملية بصيغة Excel"
          >
            ↓ تقرير تفصيلي ({appliedRowsCount})
          </a>
        ) : null}
        {auditLogId && <TransactionRollbackButton logId={auditLogId} rolledBack={isRolledBack} />}
      </span>
    );
  }

  if (action === "CREATE_FACILITY") {
    return (
      <span>
        <span className="font-bold text-slate-800 dark:text-slate-200">{String(m.name ?? "-")}</span>
        <span className="mr-1.5 text-slate-400 dark:text-slate-500 font-mono text-xs">{String(m.new_facility_username ?? "-")}</span>
        {m.is_admin ? <span className="mr-1 inline-flex items-center rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">المبرمج</span> : null}
      </span>
    );
  }

  if (action === "IMPORT_FACILITIES") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        تمت إضافة: <strong className="text-slate-700 dark:text-slate-300">{String(m.created ?? "-")}</strong>
        {" · "}متخطاة: <strong className="text-slate-700 dark:text-slate-300">{String(m.skipped ?? "-")}</strong>
      </span>
    );
  }

  if (action === "DELETE_FACILITY") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {m.name ? <strong className="text-slate-700 dark:text-slate-300">{String(m.name)}</strong> : null}
        {m.deleted_facility_username ? <span className="mr-1.5 font-mono text-xs">{String(m.deleted_facility_username)}</span> : null}
      </span>
    );
  }

  return "-";
}

function badgeClassForAction(action: string) {
  if (
    action.startsWith("CREATE") ||
    action === "DEDUCT_BALANCE" ||
    action === "IMPORT_TRANSACTIONS" ||
    action === "IMPORT_BENEFICIARIES_BACKGROUND" ||
    action === "IMPORT_FACILITIES"
  ) {
    return "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400";
  }
  if (action.startsWith("DELETE") || action === "CANCEL_TRANSACTION" || action === "PERMANENT_DELETE_BENEFICIARY") {
    return "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400";
  }
  return "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300";
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; target?: string; actor?: string; start_date?: string; end_date?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const canView = session.is_admin || (session.is_manager && session.manager_permissions?.view_audit_log);
  if (!canView) redirect("/dashboard");

  const { page: pageParam, target: targetParam, actor, start_date, end_date } = await searchParams;

  const target: TargetFilter =
    targetParam === "beneficiaries" || targetParam === "transactions" || targetParam === "facilities" || targetParam === "completed"
      ? targetParam
      : "all";

  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (start_date) {
    const d = new Date(start_date);
    if (!isNaN(d.getTime())) createdAtFilter.gte = d;
  }
  if (end_date) {
    const d = new Date(end_date);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAtFilter.lte = d;
    }
  }

  // فلتر المكتملين: عمليات DEDUCT_BALANCE + IMPORT_TRANSACTIONS التي تحمل beneficiary_completed أو importedFamilies
  const completedMetadataFilter = target === "completed"
    ? { path: ["beneficiary_completed"], equals: true }
    : undefined;

  const where = {
    action: { in: TARGET_ACTIONS[target] },
    ...(actor?.trim() ? { user: { contains: actor.trim(), mode: "insensitive" as const } } : {}),
    ...(Object.keys(createdAtFilter).length > 0 ? { created_at: createdAtFilter } : {}),
    ...(completedMetadataFilter ? { metadata: completedMetadataFilter } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        user: true,
        action: true,
        facility_id: true,
        metadata: true,
        created_at: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const editTransactionIds = rows.flatMap((row) => {
    if (row.action !== "EDIT_TRANSACTION") return [] as string[];
    if (!row.metadata || typeof row.metadata !== "object") return [] as string[];
    const txId = (row.metadata as Record<string, unknown>).transaction_id;
    return typeof txId === "string" && txId.trim().length > 0 ? [txId.trim()] : [];
  });

  const uniqueEditTransactionIds = [...new Set(editTransactionIds)];
  const editedTransactions = uniqueEditTransactionIds.length > 0
    ? await prisma.transaction.findMany({
      where: { id: { in: uniqueEditTransactionIds } },
      select: {
        id: true,
        beneficiary: {
          select: {
            name: true,
            card_number: true,
          },
        },
      },
    })
    : [];

  const lookups: AuditRenderLookups = {
    txBeneficiaryById: new Map(
      editedTransactions.map((tx) => [
        tx.id,
        { name: tx.beneficiary.name, cardNumber: tx.beneficiary.card_number },
      ])
    ),
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const buildHref = (nextPage: number) => {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    params.set("target", target);
    if (actor?.trim()) params.set("actor", actor.trim());
    if (start_date) params.set("start_date", start_date);
    if (end_date) params.set("end_date", end_date);
    return `/admin/audit-log?${params.toString()}`;
  };

  const exportParams = new URLSearchParams();
  exportParams.set("target", target);
  if (actor?.trim()) exportParams.set("actor", actor.trim());
  if (start_date) exportParams.set("start_date", start_date);
  if (end_date) exportParams.set("end_date", end_date);
  const exportHref = `/api/export/audit-log?${exportParams.toString()}`;

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-24">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-light dark:bg-primary-light/10 text-primary dark:text-blue-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">سجل المراقبة</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">متابعة عمليات الإضافة والحذف والحركات مع التاريخ والوقت</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{totalCount} عملية</Badge>
            <a
              href={exportHref}
              target="_blank"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-black text-white! transition-colors hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              <span>تنزيل Excel</span>
            </a>
            {/* SEC-FIX: سجلات التدقيق محمية — لا يمكن حذفها */}
            <span className="inline-flex h-10 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs font-bold text-gray-400 select-none" title="سجلات التدقيق محمية ولا يمكن حذفها">
              🔒 السجلات محمية
            </span>
          </div>
        </div>

        <Card className="p-4">
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5 md:items-end">
            <input type="hidden" name="page" value="1" />

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">النوع</label>
              <select
                name="target"
                defaultValue={target}
                className="flex h-10 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <option value="all">الكل</option>
                <option value="beneficiaries">المستفيدون</option>
                <option value="transactions">الحركات</option>
                <option value="facilities">المرافق</option>
                <option value="completed">المكتملون ✓</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المنفذ</label>
              <Input name="actor" defaultValue={actor ?? ""} placeholder="اسم المستخدم" className="h-10" />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">من تاريخ</label>
              <DateInput name="start_date" defaultValue={start_date ?? ""} className="h-10" />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">إلى تاريخ</label>
              <DateInput name="end_date" defaultValue={end_date ?? ""} className="h-10" />
            </div>

            <div className="sm:col-span-2 md:col-span-1">
              <Button type="submit" className="h-10 w-full">تطبيق الفلتر</Button>
            </div>
          </form>
        </Card>

        {rows.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">لا توجد سجلات مطابقة للفلاتر الحالية</p>
          </Card>
        ) : (
          <>
            {/* ── جدول: شاشات md وأكبر ── */}
            <Card className="hidden md:block overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">العملية</th>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">المنفذ</th>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">التفاصيل</th>
                      <th className="px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${badgeClassForAction(row.action)}`}>
                            {actionLabel(row.action)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm font-bold text-slate-800 dark:text-slate-200">{row.user}</td>
                        <td className="px-5 py-3 text-sm text-slate-600 dark:text-slate-400">{summarizeMetadata(row.action, row.metadata, row.id, lookups)}</td>
                        <td className="px-5 py-3 text-sm text-slate-500 dark:text-slate-400">
                          {formatDateTimeTripoli(row.created_at, "ar-LY", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ── بطاقات: شاشات أقل من md ── */}
            <div className="md:hidden space-y-2">
              {rows.map((row) => (
                <Card key={row.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${badgeClassForAction(row.action)}`}>
                      {actionLabel(row.action)}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                      {formatDateTimeTripoli(row.created_at, "ar-LY", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    المنفذ: <span className="text-slate-800 dark:text-slate-200">{row.user}</span>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {summarizeMetadata(row.action, row.metadata, row.id, lookups)}
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-1">
            {page > 1 ? (
              <Link
                href={buildHref(page - 1)}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                السابق
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
                السابق
              </span>
            )}
            <span className="text-sm text-slate-500 dark:text-slate-400">
              صفحة {page} من {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildHref(page + 1)}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                التالي
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
                التالي
              </span>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
