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
import { BulkBeneficiaryRollbackButton } from "@/components/bulk-beneficiary-rollback-button";
import { formatDateTimeTripoli } from "@/lib/datetime";

type TargetFilter = "all" | "beneficiaries" | "transactions" | "facilities" | "completed" | "merges" | "security";

const PAGE_SIZE = 30;

const TARGET_ACTIONS: Record<TargetFilter, string[]> = {
  all: [
    "CREATE_BENEFICIARY",
    "UPDATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
    "BULK_DELETE_BENEFICIARY",
    "BULK_PERMANENT_DELETE_BENEFICIARY",
    "BULK_RESTORE_BENEFICIARY",
    "BULK_RENEW_BALANCE",
    "UNDO_BULK_RENEW_BALANCE",
    "UNDO_BULK_DELETE_BENEFICIARY",
    "UNDO_BULK_RESTORE_BENEFICIARY",
    "UNDO_FIX_PARENT_CARD_PATTERNS",
    "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
    "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
    "MERGE_DUPLICATE_BENEFICIARY",
    "UNDO_MERGE_DUPLICATE_BENEFICIARY",
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
    "ROLLBACK_IMPORT_TRANSACTIONS",
    "SETTLE_OVERDRAWN_FAMILY_DEBT",
    "CREATE_FACILITY",
    "IMPORT_FACILITIES",
    "UPDATE_FACILITY",
    "DELETE_FACILITY",
    "ROLLBACK_IMPORT",
    "FIX_PARENT_CARD_PATTERNS",
    "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
    "LOGIN",
    "LOGOUT",
    "CHANGE_PASSWORD",
    "CREATE_MANAGER",
    "UPDATE_MANAGER",
    "DELETE_MANAGER",
  ],
  beneficiaries: [
    "CREATE_BENEFICIARY",
    "UPDATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "ROLLBACK_IMPORT",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
    "BULK_DELETE_BENEFICIARY",
    "BULK_PERMANENT_DELETE_BENEFICIARY",
    "BULK_RESTORE_BENEFICIARY",
    "BULK_RENEW_BALANCE",
    "UNDO_BULK_RENEW_BALANCE",
    "UNDO_BULK_DELETE_BENEFICIARY",
    "UNDO_BULK_RESTORE_BENEFICIARY",
    "FIX_PARENT_CARD_PATTERNS",
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
    "ROLLBACK_IMPORT_TRANSACTIONS",
    "SETTLE_OVERDRAWN_FAMILY_DEBT",
  ],
  facilities: ["CREATE_FACILITY", "IMPORT_FACILITIES", "UPDATE_FACILITY", "DELETE_FACILITY"],
  completed: [
    "DEDUCT_BALANCE",
    "IMPORT_TRANSACTIONS",
    "SETTLE_OVERDRAWN_FAMILY_DEBT",
    "BULK_RENEW_BALANCE",
    "UNDO_BULK_RENEW_BALANCE",
    "UNDO_BULK_DELETE_BENEFICIARY",
    "UNDO_BULK_RESTORE_BENEFICIARY",
    "UNDO_FIX_PARENT_CARD_PATTERNS",
    "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
  ],
  merges: ["MERGE_DUPLICATE_BENEFICIARY", "UNDO_MERGE_DUPLICATE_BENEFICIARY"],
  security: ["LOGIN", "LOGOUT", "CHANGE_PASSWORD", "CREATE_MANAGER", "UPDATE_MANAGER", "DELETE_MANAGER"],
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
    case "BULK_DELETE_BENEFICIARY":
      return "حذف جماعي لمستفيدين";
    case "BULK_PERMANENT_DELETE_BENEFICIARY":
      return "حذف نهائي جماعي لمستفيدين";
    case "BULK_RESTORE_BENEFICIARY":
      return "استرجاع جماعي لمستفيدين";
    case "BULK_RENEW_BALANCE":
      return "تجديد جماعي للأرصدة";
    case "UNDO_BULK_RENEW_BALANCE":
      return "تراجع عن التجديد الجماعي";
    case "UNDO_BULK_DELETE_BENEFICIARY":
      return "تراجع عن الحذف الجماعي";
    case "UNDO_BULK_RESTORE_BENEFICIARY":
      return "تراجع عن الاسترجاع الجماعي";
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
    case "SETTLE_OVERDRAWN_FAMILY_DEBT":
      return "تسوية مديونية تجاوز الرصيد";
    case "CREATE_FACILITY":
      return "إضافة مرفق";
    case "IMPORT_FACILITIES":
      return "استيراد مرافق";
    case "DELETE_FACILITY":
      return "حذف مرفق";
    case "ROLLBACK_IMPORT":
      return "تراجع عن استيراد";
    case "ROLLBACK_IMPORT_TRANSACTIONS":
      return "تراجع عن استيراد الحركات";
    case "FIX_PARENT_CARD_PATTERNS":
      return "تحويل نمط بطاقات الأب/الأم";
    case "UNDO_FIX_PARENT_CARD_PATTERNS":
      return "تراجع عن تحويل نمط البطاقات";
    case "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION":
      return "تصحيح توزيع الاستيراد المجمع";
    case "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION":
      return "تراجع عن تصحيح توزيع الاستيراد";
    case "MERGE_DUPLICATE_BENEFICIARY":
      return "دمج مستفيدين مكررين";
    case "UNDO_MERGE_DUPLICATE_BENEFICIARY":
      return "تراجع عن الدمج";
    case "UPDATE_FACILITY":
      return "تعديل مرفق";
    case "LOGIN":
      return "تسجيل دخول";
    case "LOGOUT":
      return "تسجيل خروج";
    case "CHANGE_PASSWORD":
      return "تغيير كلمة المرور";
    case "CREATE_MANAGER":
      return "إضافة مدير";
    case "UPDATE_MANAGER":
      return "تعديل مدير";
    case "DELETE_MANAGER":
      return "حذف مدير";
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
  txBalanceAfterById: Map<string, number>;
  txAmountById: Map<string, number>;
};

type ActorLookupMaps = {
  byUsername: Map<string, { name: string; is_admin: boolean; is_manager: boolean }>;
  byFacilityId: Map<string, { name: string; is_admin: boolean; is_manager: boolean }>;
};

function formatExecutorLabel(user: string, facilityId: string | null, actorLookups: ActorLookupMaps): string {
  const actorByUsername = actorLookups.byUsername.get(user);
  if (actorByUsername) {
    return actorByUsername.name;
  }

  if (facilityId) {
    const actorByFacilityId = actorLookups.byFacilityId.get(facilityId);
    if (actorByFacilityId) {
      return actorByFacilityId.name;
    }
  }

  return user;
}

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
    const transactionId = getMetadataValue(m, "transaction_id");
    const txLookup = typeof transactionId === "string" ? lookups?.txBeneficiaryById.get(transactionId) : undefined;
    const name = m.beneficiary_name ? String(m.beneficiary_name) : (txLookup?.name ?? null);
    const cardNumber = m.card_number ? String(m.card_number) : (txLookup?.cardNumber ?? "-");
    const metadataAmount = Number(getMetadataValue(m, "amount"));
    const lookupAmount = typeof transactionId === "string" ? lookups?.txAmountById.get(transactionId) : undefined;
    const effectiveAmount = Number.isFinite(metadataAmount) && metadataAmount > 0
      ? metadataAmount
      : (typeof lookupAmount === "number" ? lookupAmount : null);
    const computedAfter = typeof transactionId === "string" ? lookups?.txBalanceAfterById.get(transactionId) : undefined;
    const effectiveBefore = balanceBefore !== "-"
      ? balanceBefore
      : (typeof computedAfter === "number" && typeof effectiveAmount === "number" ? computedAfter + effectiveAmount : "-");
    const effectiveAfter = balanceAfter !== "-"
      ? balanceAfter
      : (typeof computedAfter === "number" ? computedAfter : "-");
    const completed = m.beneficiary_completed ? true : false;
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {name && <span className="font-bold text-slate-800 dark:text-slate-200">{name}</span>}
        <span className="text-slate-500 dark:text-slate-400">بطاقة: {cardNumber}</span>
        <span className="text-slate-500 dark:text-slate-400">مبلغ: {String(m.amount ?? "-")} د.ل</span>
        <span className="text-slate-500 dark:text-slate-400">قبل: {String(effectiveBefore)} د.ل</span>
        <span className="text-slate-500 dark:text-slate-400">بعد: {String(effectiveAfter)} د.ل</span>
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
    const beneficiaryName = getMetadataValue(m, "beneficiary_name");
    const cardNumber = getMetadataValue(m, "card_number");
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {beneficiaryName !== "-" ? <span className="font-bold text-slate-700 dark:text-slate-300">{String(beneficiaryName)}</span> : null}
        {beneficiaryName !== "-" ? <span className="mr-1.5">·</span> : null}
        مبلغ مرتجع: <strong className="text-slate-700 dark:text-slate-300">{String(m.refunded_amount ?? "-")} د.ل</strong>
        {cardNumber !== "-" ? <span className="mr-1.5">· بطاقة: {String(cardNumber)}</span> : null}
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "REVERT_CANCELLATION") {
    const beneficiaryName = getMetadataValue(m, "beneficiary_name");
    const cardNumber = getMetadataValue(m, "card_number");
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {beneficiaryName !== "-" ? <span className="font-bold text-slate-700 dark:text-slate-300">{String(beneficiaryName)} · </span> : null}
        {cardNumber !== "-" ? <span>بطاقة: {String(cardNumber)} · </span> : null}
        <span>إلغاء الإلغاء</span>
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "SOFT_DELETE_TRANSACTION") {
    const beneficiaryName = getMetadataValue(m, "beneficiary_name");
    const cardNumber = getMetadataValue(m, "card_number");
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {beneficiaryName !== "-" ? <span className="font-bold text-slate-700 dark:text-slate-300">{String(beneficiaryName)} · </span> : null}
        {cardNumber !== "-" ? <span>بطاقة: {String(cardNumber)} · </span> : null}
        مبلغ مرتجع: <strong className="text-slate-700 dark:text-slate-300">{String(m.refunded_amount ?? "-")} د.ل</strong>
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "RESTORE_SOFT_DELETED_TRANSACTION") {
    const beneficiaryName = getMetadataValue(m, "beneficiary_name");
    const cardNumber = getMetadataValue(m, "card_number");
    return (
      <span className="text-slate-500 dark:text-slate-400">
        {beneficiaryName !== "-" ? <span className="font-bold text-slate-700 dark:text-slate-300">{String(beneficiaryName)} · </span> : null}
        {cardNumber !== "-" ? <span>بطاقة: {String(cardNumber)} · </span> : null}
        مبلغ مخصوم: <strong className="text-slate-700 dark:text-slate-300">{String(m.deducted_amount ?? "-")} د.ل</strong>
        <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span>
        <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span>
      </span>
    );
  }

  if (action === "PERMANENT_DELETE_TRANSACTION") {
    const beneficiaryName = getMetadataValue(m, "beneficiary_name");
    const cardNumber = getMetadataValue(m, "card_number");
    const pairDelete = m.pair_delete === true;
    const balanceChanges = Array.isArray(m.balance_changes) ? (m.balance_changes as Array<Record<string, unknown>>) : [];
    return (
      <div className="text-slate-500 dark:text-slate-400 space-y-1">
        <div>
          تم حذف نهائي: <strong className="text-slate-700 dark:text-slate-300">{String(m.deleted_count ?? "-")}</strong>
          {pairDelete ? <span className="mr-1.5">· حذف زوج (إلغاء + أصل)</span> : null}
          {beneficiaryName !== "-" ? <span className="mr-1.5 font-bold text-slate-700 dark:text-slate-300">· {String(beneficiaryName)}</span> : null}
          {cardNumber !== "-" ? <span className="mr-1.5">· بطاقة: {String(cardNumber)}</span> : null}
          {balanceBefore !== "-" ? <span className="mr-1.5">· قبل: {String(balanceBefore)} د.ل</span> : null}
          {balanceAfter !== "-" ? <span className="mr-1.5">· بعد: {String(balanceAfter)} د.ل</span> : null}
        </div>
        {balanceChanges.length > 0 && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {balanceChanges.slice(0, 3).map((b, idx) => (
              <span key={idx} className="ml-2 inline-block">
                {String(b.beneficiary_name ?? "-")} ({String(b.card_number ?? "-")})
                {" "}قبل: {String(b.balance_before ?? "-")} · بعد: {String(b.balance_after ?? "-")}
              </span>
            ))}
            {balanceChanges.length > 3 ? <span>... +{balanceChanges.length - 3}</span> : null}
          </div>
        )}
      </div>
    );
  }

  if (action === "BULK_CANCEL_TRANSACTION" || action === "BULK_REDEDUCT_TRANSACTION") {
    const items = Array.isArray(m.items) ? (m.items as Array<Record<string, unknown>>) : [];
    return (
      <div className="text-slate-500 dark:text-slate-400 space-y-1">
        <div>
          مختارة: <strong className="text-slate-700 dark:text-slate-300">{String(m.selected_count ?? "-")}</strong>
          <span className="mr-1.5">· منفذة: {String(m.processed_count ?? "-")}</span>
          <span className="mr-1.5">· ناجحة: {String(m.cancelled_count ?? m.rededucted_count ?? "-")}</span>
          <span className="mr-1.5">· متخطاة: {String(m.skipped_count ?? "-")}</span>
        </div>
        {items.length > 0 && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {items.slice(0, 3).map((it, idx) => (
              <span key={idx} className="ml-2 inline-block">
                {String(it.beneficiary_name ?? "-")} ({String(it.card_number ?? "-")})
                {" "}· مبلغ: {String(it.amount ?? "-")} د.ل
                {" "}· قبل: {String(it.balance_before ?? "-")} د.ل
                {" "}· بعد: {String(it.balance_after ?? "-")} د.ل
              </span>
            ))}
            {items.length > 3 ? <span>... +{items.length - 3}</span> : null}
          </div>
        )}
        {auditLogId && items.length > 0 ? (
          <a
            href={`/api/export/audit-log?log_id=${encodeURIComponent(auditLogId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
            title="تصدير تفاصيل هذه العملية بصيغة Excel"
          >
            ↓ تقرير تفصيلي ({items.length})
          </a>
        ) : null}
      </div>
    );
  }

  if (
    action === "BULK_DELETE_BENEFICIARY"
    || action === "BULK_PERMANENT_DELETE_BENEFICIARY"
    || action === "BULK_RESTORE_BENEFICIARY"
  ) {
    const details = Array.isArray(m.details) ? (m.details as Array<Record<string, unknown>>) : [];
    const isRolledBack = Boolean(m.undo_reverted_at);
    const successCount = details.filter((d) => String(d.result ?? "") !== "skipped").length;
    const skippedCount = details.filter((d) => String(d.result ?? "") === "skipped").length;

    return (
      <div className="text-slate-500 dark:text-slate-400 space-y-1">
        <div>
          مختارة: <strong className="text-slate-700 dark:text-slate-300">{String(m.selected_count ?? "-")}</strong>
          <span className="mr-1.5">· منفذة: {String(successCount)}</span>
          <span className="mr-1.5">· متخطاة: {String(skippedCount)}</span>
        </div>
        {details.length > 0 && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {details.slice(0, 3).map((it, idx) => (
              <span key={idx} className="ml-2 inline-block">
                {String(it.beneficiary_name ?? "-")} ({String(it.card_number ?? "-")})
                {" "}· النتيجة: {String(it.result ?? "-")}
              </span>
            ))}
            {details.length > 3 ? <span>... +{details.length - 3}</span> : null}
          </div>
        )}
        {auditLogId && details.length > 0 ? (
          <a
            href={`/api/export/audit-log?log_id=${encodeURIComponent(auditLogId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
            title="تصدير تفاصيل هذه العملية بصيغة Excel"
          >
            ↓ تقرير تفصيلي ({details.length})
          </a>
        ) : null}
        {auditLogId && action !== "BULK_PERMANENT_DELETE_BENEFICIARY" ? (
          <BulkBeneficiaryRollbackButton logId={auditLogId} rolledBack={isRolledBack} />
        ) : null}
      </div>
    );
  }

  if (action === "BULK_RENEW_BALANCE") {
    const details = Array.isArray(m.details) ? (m.details as Array<Record<string, unknown>>) : [];
    const isRolledBack = Boolean(m.undo_reverted_at);
    return (
      <span className="flex flex-wrap gap-x-2 text-slate-500 dark:text-slate-400">
        <span>مستفيدون: <strong className="text-slate-700 dark:text-slate-300">{String(m.beneficiary_count ?? details.length)}</strong></span>
        <span>قيمة التجديد: <strong className="text-slate-700 dark:text-slate-300">{String(m.renewal_amount ?? "-")} د.ل</strong></span>
        {auditLogId && details.length > 0 ? (
          <a
            href={`/api/export/audit-log?log_id=${encodeURIComponent(auditLogId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
            title="تصدير تفاصيل هذه العملية بصيغة Excel"
          >
            ↓ تقرير تفصيلي ({details.length})
          </a>
        ) : null}
        {auditLogId ? <BulkBeneficiaryRollbackButton logId={auditLogId} rolledBack={isRolledBack} allowSelective /> : null}
      </span>
    );
  }

  if (action === "UNDO_BULK_RENEW_BALANCE") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        عملية أصلية: <strong className="text-slate-700 dark:text-slate-300">{String(m.original_audit_log_id ?? "-")}</strong>
        <span className="mr-1.5">· مستفيدون مُرجعون: {String(m.reverted_count ?? "-")}</span>
      </span>
    );
  }

  if (action === "UNDO_BULK_DELETE_BENEFICIARY" || action === "UNDO_BULK_RESTORE_BENEFICIARY") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        عملية أصلية: <strong className="text-slate-700 dark:text-slate-300">{String(m.original_audit_log_id ?? "-")}</strong>
        <span className="mr-1.5">· عناصر مُرجعة: {String(m.reverted_count ?? "-")}</span>
      </span>
    );
  }

  if (action === "FIX_PARENT_CARD_PATTERNS") {
    const details = Array.isArray(m.details) ? (m.details as Array<Record<string, unknown>>) : [];
    const isRolledBack = Boolean(m.undo_reverted_at);
    return (
      <span className="flex flex-wrap gap-x-2 text-slate-500 dark:text-slate-400">
        <span>النمط: <strong className="text-slate-700 dark:text-slate-300">{String(m.mode ?? "-")}</strong></span>
        <span>منفذ: <strong className="text-slate-700 dark:text-slate-300">{String(m.processed_count ?? "-")}</strong></span>
        <span>متخطى: <strong className="text-slate-700 dark:text-slate-300">{String(m.skipped_count ?? "-")}</strong></span>
        <span>تضارب: <strong className="text-slate-700 dark:text-slate-300">{String(m.conflict_count ?? "-")}</strong></span>
        <span>تصحيح H2: <strong className="text-slate-700 dark:text-slate-300">{String(m.h2_fixed_count ?? "-")}</strong></span>
        <span>تحويل M/F: <strong className="text-slate-700 dark:text-slate-300">{String(m.parent_suffix_normalized_count ?? "-")}</strong></span>
        {auditLogId && details.length > 0 ? (
          <a
            href={`/api/export/audit-log?log_id=${encodeURIComponent(auditLogId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
            title="تصدير تفاصيل هذه العملية بصيغة Excel"
          >
            ↓ تقرير تفصيلي ({details.length})
          </a>
        ) : null}
        {auditLogId ? <BulkBeneficiaryRollbackButton logId={auditLogId} rolledBack={isRolledBack} /> : null}
      </span>
    );
  }

  if (action === "UNDO_FIX_PARENT_CARD_PATTERNS") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        عملية أصلية: <strong className="text-slate-700 dark:text-slate-300">{String(m.original_audit_log_id ?? "-")}</strong>
        <span className="mr-1.5">· عناصر مُرجعة: {String(m.reverted_count ?? "-")}</span>
      </span>
    );
  }

  if (action === "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION") {
    const details = Array.isArray(m.details) ? (m.details as Array<Record<string, unknown>>) : [];
    const isRolledBack = Boolean(m.undo_reverted_at);
    return (
      <span className="flex flex-wrap gap-x-2 text-slate-500 dark:text-slate-400">
        <span>عائلات: <strong className="text-slate-700 dark:text-slate-300">{String(m.processed_families ?? "-")}</strong></span>
        <span>أفراد: <strong className="text-slate-700 dark:text-slate-300">{String(m.processed_members ?? "-")}</strong></span>
        <span>تحديث حركات: <strong className="text-slate-700 dark:text-slate-300">{String(m.updated_transactions ?? "-")}</strong></span>
        <span>إنشاء: <strong className="text-slate-700 dark:text-slate-300">{String(m.created_transactions ?? "-")}</strong></span>
        <span>إلغاء تكرارات: <strong className="text-slate-700 dark:text-slate-300">{String(m.cancelled_transactions ?? "-")}</strong></span>
        {auditLogId && details.length > 0 ? (
          <a
            href={`/api/export/audit-log?log_id=${encodeURIComponent(auditLogId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
            title="تصدير تفاصيل هذه العملية بصيغة Excel"
          >
            ↓ تقرير تفصيلي ({details.length})
          </a>
        ) : null}
        {auditLogId ? <BulkBeneficiaryRollbackButton logId={auditLogId} rolledBack={isRolledBack} /> : null}
      </span>
    );
  }

  if (action === "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        عملية أصلية: <strong className="text-slate-700 dark:text-slate-300">{String(m.original_audit_log_id ?? "-")}</strong>
        <span className="mr-1.5">· عناصر مُرجعة: {String(m.reverted_count ?? "-")}</span>
      </span>
    );
  }

  if (action === "ROLLBACK_IMPORT_TRANSACTIONS") {
    return (
      <span className="text-slate-500 dark:text-slate-400">
        عملية أصلية: <strong className="text-slate-700 dark:text-slate-300">{String(m.originalLogId ?? "-")}</strong>
        <span className="mr-1.5">· مستفيدون مُسترجعون: {String(m.restoredBeneficiaries ?? "-")}</span>
        <span className="mr-1.5">· حركات محذوفة: {String(m.deletedTransactions ?? "-")}</span>
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

  if (action === "SETTLE_OVERDRAWN_FAMILY_DEBT") {
    const summary = (m.summary ?? {}) as Record<string, unknown>;
    const affectedDebtors = Number(summary.affectedDebtors ?? 0);
    const settledDebtors = Number(summary.settledDebtors ?? 0);
    const unresolvedDebtors = Number(summary.unresolvedDebtors ?? 0);
    const affectedFamilyMembers = Number(summary.affectedFamilyMembers ?? 0);
    const totalDebtBefore = Number(summary.totalDebtBefore ?? 0);
    const totalDistributed = Number(summary.totalDistributed ?? 0);
    const totalDebtAfter = Number(summary.totalDebtAfter ?? 0);

    return (
      <span className="flex flex-wrap gap-x-2 text-slate-500 dark:text-slate-400">
        <span>حالات: <strong className="text-slate-700 dark:text-slate-300">{affectedDebtors}</strong></span>
        <span>تم التوافق: <strong className="text-emerald-700 dark:text-emerald-400">{settledDebtors}</strong></span>
        <span>متبقي: <strong className="text-red-700 dark:text-red-400">{unresolvedDebtors}</strong></span>
        <span>متأثرون: <strong className="text-slate-700 dark:text-slate-300">{affectedFamilyMembers}</strong></span>
        <span>الدين قبل: <strong className="text-slate-700 dark:text-slate-300">{totalDebtBefore.toLocaleString("ar-LY")}</strong></span>
        <span>الموزع: <strong className="text-slate-700 dark:text-slate-300">{totalDistributed.toLocaleString("ar-LY")}</strong></span>
        <span>الدين بعد: <strong className="text-slate-700 dark:text-slate-300">{totalDebtAfter.toLocaleString("ar-LY")}</strong></span>
        {auditLogId ? (
          <a
            href={`/api/admin/duplicates/debt-over-limit/export?mode=after&auditId=${encodeURIComponent(auditLogId)}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded border border-sky-200 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-colors"
            title="تصدير تقرير بعد المعالجة بصيغة Excel"
          >
            ↓ تقرير بعد المعالجة
          </a>
        ) : null}
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
    action === "BULK_RENEW_BALANCE" ||
    action === "UNDO_BULK_RENEW_BALANCE" ||
    action === "UNDO_BULK_DELETE_BENEFICIARY" ||
    action === "UNDO_BULK_RESTORE_BENEFICIARY" ||
    action === "UNDO_FIX_PARENT_CARD_PATTERNS" ||
    action === "FIX_PARENT_CARD_PATTERNS" ||
    action === "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION" ||
    action === "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION" ||
    action === "SETTLE_OVERDRAWN_FAMILY_DEBT" ||
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
  const actorTerm = actor?.trim() ?? "";

  const target: TargetFilter =
    targetParam === "beneficiaries" || targetParam === "transactions" || targetParam === "facilities" || targetParam === "completed" || targetParam === "merges" || targetParam === "security"
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

  // نعتمد على نوع العملية نفسها في تبويب "المكتمل" لأن بعض العمليات
  // (مثل تسوية مديونية تجاوز الرصيد) لا تستخدم beneficiary_completed.
  const completedMetadataFilter = undefined;

  const actorMatchedFacilityIds = actorTerm
    ? (await prisma.facility.findMany({
      where: {
        OR: [
          { name: { contains: actorTerm, mode: "insensitive" } },
          { username: { contains: actorTerm, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 200,
    })).map((f) => f.id)
    : [];

  const where = {
    action: { in: TARGET_ACTIONS[target] },
    ...(actorTerm
      ? {
        OR: [
          { user: { contains: actorTerm, mode: "insensitive" as const } },
          ...(actorMatchedFacilityIds.length > 0
            ? [{ facility_id: { in: actorMatchedFacilityIds } }]
            : []),
        ],
      }
      : {}),
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

  const actorUsernames = [...new Set(rows.map((row) => row.user).filter((u) => typeof u === "string" && u.trim().length > 0))];
  const actorFacilityIds = [...new Set(rows.flatMap((row) => (row.facility_id ? [row.facility_id] : [])))];

  const actorFacilities = (actorUsernames.length > 0 || actorFacilityIds.length > 0)
    ? await prisma.facility.findMany({
      where: {
        OR: [
          ...(actorUsernames.length > 0 ? [{ username: { in: actorUsernames } }] : []),
          ...(actorFacilityIds.length > 0 ? [{ id: { in: actorFacilityIds } }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        username: true,
        is_admin: true,
        is_manager: true,
      },
    })
    : [];

  const actorLookups: ActorLookupMaps = {
    byUsername: new Map(
      actorFacilities.map((f) => [
        f.username,
        { name: f.name, is_admin: f.is_admin, is_manager: f.is_manager },
      ])
    ),
    byFacilityId: new Map(
      actorFacilities.map((f) => [
        f.id,
        { name: f.name, is_admin: f.is_admin, is_manager: f.is_manager },
      ])
    ),
  };

  const loggedTransactionIds = rows.flatMap((row) => {
    if (row.action !== "EDIT_TRANSACTION" && row.action !== "DEDUCT_BALANCE") return [] as string[];
    if (!row.metadata || typeof row.metadata !== "object") return [] as string[];
    const txId = (row.metadata as Record<string, unknown>).transaction_id;
    return typeof txId === "string" && txId.trim().length > 0 ? [txId.trim()] : [];
  });

  const uniqueLoggedTransactionIds = [...new Set(loggedTransactionIds)];
  const loggedTransactions = uniqueLoggedTransactionIds.length > 0
    ? await prisma.transaction.findMany({
      where: { id: { in: uniqueLoggedTransactionIds } },
      select: {
        id: true,
        beneficiary_id: true,
        amount: true,
        type: true,
        is_cancelled: true,
        created_at: true,
        original_transaction_id: true,
        beneficiary: {
          select: {
            name: true,
            card_number: true,
          },
        },
      },
    })
    : [];

  const loggedBeneficiaryIds = [...new Set(loggedTransactions.map((tx) => tx.beneficiary_id))];
  const maxLoggedCreatedAt = loggedTransactions.reduce<Date | null>((acc, tx) => {
    if (!acc || tx.created_at > acc) return tx.created_at;
    return acc;
  }, null);

  const txBalanceAfterById = new Map<string, number>();
  if (loggedBeneficiaryIds.length > 0 && maxLoggedCreatedAt) {
    const [beneficiaryTotals, historyRows] = await Promise.all([
      prisma.beneficiary.findMany({
        where: { id: { in: loggedBeneficiaryIds } },
        select: { id: true, total_balance: true },
      }),
      prisma.transaction.findMany({
        where: {
          beneficiary_id: { in: loggedBeneficiaryIds },
          created_at: { lte: maxLoggedCreatedAt },
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
      txBalanceAfterById.set(tx.id, Math.max(0, next));
    }
  }

  const lookups: AuditRenderLookups = {
    txBeneficiaryById: new Map(
      loggedTransactions.map((tx) => [
        tx.id,
        { name: tx.beneficiary.name, cardNumber: tx.beneficiary.card_number },
      ])
    ),
    txBalanceAfterById,
    txAmountById: new Map(loggedTransactions.map((tx) => [tx.id, Number(tx.amount)])),
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
                <option value="merges">الدمج</option>
                <option value="security">الأمان / الجلسات</option>
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
                        <td className="px-5 py-3 text-sm">
                          <div className="font-bold text-slate-800 dark:text-slate-200">
                            {formatExecutorLabel(row.user, row.facility_id, actorLookups)}
                          </div>
                          <div className="text-xs text-slate-400 dark:text-slate-500">{row.user}</div>
                        </td>
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
                    المنفذ: <span className="text-slate-800 dark:text-slate-200">{formatExecutorLabel(row.user, row.facility_id, actorLookups)}</span>
                    <div className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">{row.user}</div>
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
