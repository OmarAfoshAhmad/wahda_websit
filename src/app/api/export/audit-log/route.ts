import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";

type TargetFilter = "all" | "beneficiaries" | "transactions" | "facilities";

type ImportAppliedRow = {
  beneficiaryName: string;
  cardNumber: string;
  familyBaseCard: string;
  familySize: number;
  balanceBefore: number;
  deductedAmount: number;
  familyTotalDeduction: number;
  balanceAfter: number;
};

type BulkDetailRow = {
  action: string;
  beneficiaryName: string;
  cardNumber: string;
  amount: number | string;
  beforeValue: number | string;
  afterValue: number | string;
  result: string;
};

const EXPORT_LIMIT = 50_000;

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
    "CREATE_FACILITY",
    "IMPORT_FACILITIES",
    "DELETE_FACILITY",
    "ROLLBACK_IMPORT",
    "FIX_PARENT_CARD_PATTERNS",
    "UNDO_FIX_PARENT_CARD_PATTERNS",
    "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
    "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
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
    "UNDO_FIX_PARENT_CARD_PATTERNS",
    "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
    "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION",
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
  ],
  facilities: ["CREATE_FACILITY", "IMPORT_FACILITIES", "DELETE_FACILITY"],
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

function summarizeMetadata(action: string, metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "-";
  const m = metadata as Record<string, unknown>;
  const balanceBefore = getMetadataValue(m, "balance_before", "balanceBefore", "before_balance");
  const balanceAfter = getMetadataValue(m, "balance_after", "balanceAfter", "after_balance");

  if (action === "CREATE_BENEFICIARY" || action === "UPDATE_BENEFICIARY") {
    return `بطاقة: ${String(m.card_number ?? "-")} · رصيد متبقٍ: ${String(getMetadataValue(m, "old_remaining_balance"))} ← ${String(getMetadataValue(m, "new_remaining_balance"))}`;
  }

  if (action === "EDIT_TRANSACTION") {
    const oldBeforeDeduction = getMetadataValue(m, "old_balance_before_deduction", "balance_before");
    const oldDeducted = getMetadataValue(m, "old_deducted_amount", "old_amount");
    const oldRemaining = getMetadataValue(m, "old_remaining_after_deduction", "balance_before");
    const newBeforeDeduction = getMetadataValue(m, "new_balance_before_deduction", "balance_before");
    const newDeducted = getMetadataValue(m, "new_deducted_amount", "new_amount");
    const newRemaining = getMetadataValue(m, "new_remaining_after_deduction", "balance_after");
    return `حركة: ${String(m.transaction_id ?? "-")} · قبل التعديل: (قبل الخصم ${String(oldBeforeDeduction)}، المخصوم ${String(oldDeducted)}، المتبقي ${String(oldRemaining)}) · بعد التعديل: (قبل الخصم ${String(newBeforeDeduction)}، المخصوم ${String(newDeducted)}، المتبقي ${String(newRemaining)})`;
  }

  if (action === "DELETE_BENEFICIARY" || action === "PERMANENT_DELETE_BENEFICIARY" || action === "RESTORE_BENEFICIARY") {
    return `مستفيد: ${String(m.beneficiary_id ?? "-")}`;
  }

  if (action === "BULK_DELETE_BENEFICIARY" || action === "BULK_PERMANENT_DELETE_BENEFICIARY" || action === "BULK_RESTORE_BENEFICIARY") {
    return `محدد: ${String(m.selected_count ?? "-")} · ناجح: ${String(m.deleted_count ?? m.restored_count ?? "-")} · متخطى: ${String(m.skipped_count ?? "-")}`;
  }

  if (action === "BULK_RENEW_BALANCE") {
    return `مستفيدون: ${String(m.beneficiary_count ?? "-")} · قيمة التجديد: ${String(m.renewal_amount ?? "-")}`;
  }

  if (action === "UNDO_BULK_RENEW_BALANCE") {
    return `عملية أصلية: ${String(m.original_audit_log_id ?? "-")} · مستفيدون مُرجعون: ${String(m.reverted_count ?? "-")}`;
  }

  if (action === "UNDO_BULK_DELETE_BENEFICIARY" || action === "UNDO_BULK_RESTORE_BENEFICIARY") {
    return `عملية أصلية: ${String(m.original_audit_log_id ?? "-")} · عناصر مُرجعة: ${String(m.reverted_count ?? "-")}`;
  }

  if (action === "DEDUCT_BALANCE") {
    return `بطاقة: ${String(m.card_number ?? "-")} · مبلغ: ${String(m.amount ?? "-")} · قبل: ${String(balanceBefore)} · بعد: ${String(balanceAfter)}`;
  }

  if (action === "IMPORT_BENEFICIARIES_BACKGROUND") {
    return `تمت إضافة: ${String(m.insertedRows ?? "-")} · مكررة: ${String(m.duplicateRows ?? "-")} · الإجمالي: ${String(m.totalRows ?? "-")}`;
  }

  if (action === "CANCEL_TRANSACTION") {
    return `حركة: ${String(m.original_transaction_id ?? "-")} · مبلغ مرتجع: ${String(m.refunded_amount ?? "-")} · قبل: ${String(balanceBefore)} · بعد: ${String(balanceAfter)}`;
  }

  if (action === "REVERT_CANCELLATION") {
    return `إلغاء: ${String(m.cancellation_transaction_id ?? "-")} · حركة أصلية: ${String(m.original_transaction_id ?? "-")} · قبل: ${String(balanceBefore)} · بعد: ${String(balanceAfter)}`;
  }

  if (action === "SOFT_DELETE_TRANSACTION") {
    return `حركة: ${String(m.transaction_id ?? "-")} · مبلغ مرتجع: ${String(m.refunded_amount ?? "-")} · قبل: ${String(balanceBefore)} · بعد: ${String(balanceAfter)}`;
  }

  if (action === "RESTORE_SOFT_DELETED_TRANSACTION") {
    return `حركة: ${String(m.transaction_id ?? "-")} · مبلغ مخصوم: ${String(m.deducted_amount ?? "-")} · قبل: ${String(balanceBefore)} · بعد: ${String(balanceAfter)}`;
  }

  if (action === "PERMANENT_DELETE_TRANSACTION") {
    return `محذوف نهائي: ${String(m.deleted_count ?? "-")} · تأثير الرصيد: ${String(m.balance_impact ?? 0)}`;
  }

  if (action === "BULK_CANCEL_TRANSACTION" || action === "BULK_REDEDUCT_TRANSACTION") {
    return `محدد: ${String(m.selected_count ?? "-")} · منفذ: ${String(m.processed_count ?? "-")} · ناجح: ${String(m.cancelled_count ?? m.rededucted_count ?? "-")} · متخطى: ${String(m.skipped_count ?? "-")}`;
  }

  if (action === "IMPORT_TRANSACTIONS") {
    return `تمت إضافة: ${String(m.added ?? "-")} · متخطاة: ${String(m.skipped ?? "-")}`;
  }

  if (action === "ROLLBACK_IMPORT_TRANSACTIONS") {
    return `عملية أصلية: ${String(m.originalLogId ?? "-")} · مستفيدون مُسترجعون: ${String(m.restoredBeneficiaries ?? "-")} · حركات محذوفة: ${String(m.deletedTransactions ?? "-")}`;
  }

  if (action === "CREATE_FACILITY") {
    return `مرفق: ${String(m.name ?? "-")} · مستخدم: ${String(m.new_facility_username ?? "-")}`;
  }

  if (action === "IMPORT_FACILITIES") {
    return `تمت إضافة: ${String(m.created ?? "-")} · متخطاة: ${String(m.skipped ?? "-")}`;
  }

  if (action === "DELETE_FACILITY") {
    return `معرف المرفق: ${String(m.deleted_facility_id ?? "-")}`;
  }

  if (action === "FIX_PARENT_CARD_PATTERNS") {
    return `النمط: ${String(m.mode ?? "-")} · منفذ: ${String(m.processed_count ?? "-")} · متخطى: ${String(m.skipped_count ?? "-")} · تضارب: ${String(m.conflict_count ?? "-")} · H2: ${String(m.h2_fixed_count ?? "-")} · M/F: ${String(m.parent_suffix_normalized_count ?? "-")}`;
  }

  if (action === "UNDO_FIX_PARENT_CARD_PATTERNS") {
    return `عملية أصلية: ${String(m.original_audit_log_id ?? "-")} · عناصر مُرجعة: ${String(m.reverted_count ?? "-")} · النوع: ${m.selective ? "انتقائي" : "كامل"}`;
  }

  if (action === "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION") {
    return `عائلات: ${String(m.processed_families ?? "-")} · أفراد: ${String(m.processed_members ?? "-")} · تحديث: ${String(m.updated_transactions ?? "-")} · إنشاء: ${String(m.created_transactions ?? "-")} · إلغاء تكرارات: ${String(m.cancelled_transactions ?? "-")}`;
  }

  if (action === "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION") {
    return `عملية أصلية: ${String(m.original_audit_log_id ?? "-")} · عناصر مُرجعة: ${String(m.reverted_count ?? "-")}`;
  }

  return "-";
}

function getImportAppliedRows(action: string, metadata: unknown): ImportAppliedRow[] {
  if (action !== "IMPORT_TRANSACTIONS") return [];
  if (!metadata || typeof metadata !== "object") return [];

  const rawRows = (metadata as Record<string, unknown>).appliedRows;
  if (!Array.isArray(rawRows)) return [];

  return rawRows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;

      return {
        beneficiaryName: String(item.beneficiaryName ?? "-"),
        cardNumber: String(item.cardNumber ?? "-"),
        familyBaseCard: String(item.familyBaseCard ?? "-"),
        familySize: Number(item.familySize ?? 0),
        balanceBefore: Number(item.balanceBefore ?? 0),
        deductedAmount: Number(item.deductedAmount ?? 0),
        familyTotalDeduction: Number(item.familyTotalDeduction ?? 0),
        balanceAfter: Number(item.balanceAfter ?? 0),
      } satisfies ImportAppliedRow;
    })
    .filter((row): row is ImportAppliedRow => row !== null);
}

function getBulkDetailRows(action: string, metadata: unknown): BulkDetailRow[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as Record<string, unknown>;

  const sourceRows =
    Array.isArray(m.items) ? m.items
      : Array.isArray(m.details) ? m.details
        : Array.isArray(m.balance_changes) ? m.balance_changes
          : [];

  return sourceRows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      return {
        action: actionLabel(action),
        beneficiaryName: String(item.beneficiary_name ?? item.name ?? "-"),
        cardNumber: String(item.card_number ?? item.old_card_number ?? "-"),
        amount: (item.amount ?? item.refunded_amount ?? item.deducted_amount ?? item.renewal_amount ?? "-") as number | string,
        beforeValue: (item.balance_before ?? item.remaining_before ?? item.total_before ?? item.before_deleted_at ?? item.old_card_number ?? "-") as number | string,
        afterValue: (item.balance_after ?? item.remaining_after ?? item.total_after ?? item.after_deleted_at ?? item.new_card_number ?? "-") as number | string,
        result: String(item.result ?? item.status_after ?? "-"),
      } satisfies BulkDetailRow;
    })
    .filter((row): row is BulkDetailRow => row !== null);
}

export async function GET(request: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!session.is_admin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const rateLimitError = await checkRateLimit(`api:${session.id}`, "api");
  if (rateLimitError) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const targetParam = searchParams.get("target");
  const logId = searchParams.get("log_id")?.trim() ?? "";
  const actor = searchParams.get("actor")?.trim() ?? "";
  const startDate = searchParams.get("start_date");
  const endDate = searchParams.get("end_date");

  const target: TargetFilter =
    targetParam === "beneficiaries" || targetParam === "transactions" || targetParam === "facilities"
      ? targetParam
      : "all";

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (startDate) {
    const d = new Date(startDate);
    if (!isNaN(d.getTime())) createdAtFilter.gte = d;
  }
  if (endDate) {
    const d = new Date(endDate);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAtFilter.lte = d;
    }
  }

  const actorMatchedFacilityIds = actor
    ? (await prisma.facility.findMany({
      where: {
        OR: [
          { name: { contains: actor, mode: "insensitive" } },
          { username: { contains: actor, mode: "insensitive" } },
        ],
      },
      select: { id: true },
      take: 200,
    })).map((f) => f.id)
    : [];

  const where = {
    ...(logId ? { id: logId } : {}),
    action: { in: TARGET_ACTIONS[target] },
    ...(actor
      ? {
        OR: [
          { user: { contains: actor, mode: "insensitive" as const } },
          ...(actorMatchedFacilityIds.length > 0
            ? [{ facility_id: { in: actorMatchedFacilityIds } }]
            : []),
        ],
      }
      : {}),
    ...(Object.keys(createdAtFilter).length > 0 ? { created_at: createdAtFilter } : {}),
  };

  try {
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: EXPORT_LIMIT,
      select: {
        id: true,
        user: true,
        action: true,
        metadata: true,
        created_at: true,
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("AuditLog");
    worksheet.views = [{ rightToLeft: true }];

    worksheet.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "العملية", key: "action", width: 24 },
      { header: "المنفذ", key: "user", width: 20 },
      { header: "التفاصيل", key: "details", width: 60 },
      { header: "التاريخ", key: "date", width: 18 },
      { header: "الوقت", key: "time", width: 14 },
      { header: "معرّف السجل", key: "id", width: 34 },
    ];

    worksheet.getRow(1).font = { bold: true, size: 12 };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    rows.forEach((row, idx) => {
      const created = new Date(row.created_at);
      worksheet.addRow({
        index: idx + 1,
        action: actionLabel(row.action),
        user: row.user,
        details: summarizeMetadata(row.action, row.metadata),
        date: formatDateTripoli(created, "en-GB"),
        time: formatTimeTripoli(created, "en-GB"),
        id: row.id,
      });
    });

    const importDetails = rows.flatMap((row) => {
      const created = new Date(row.created_at);
      return getImportAppliedRows(row.action, row.metadata).map((detail) => ({
        logId: row.id,
        user: row.user,
        date: formatDateTripoli(created, "en-GB"),
        time: formatTimeTripoli(created, "en-GB"),
        ...detail,
      }));
    });

    const bulkDetails = rows.flatMap((row) => {
      const created = new Date(row.created_at);
      return getBulkDetailRows(row.action, row.metadata).map((detail) => ({
        logId: row.id,
        user: row.user,
        date: formatDateTripoli(created, "en-GB"),
        time: formatTimeTripoli(created, "en-GB"),
        ...detail,
      }));
    });

    if (importDetails.length > 0) {
      const detailsSheet = workbook.addWorksheet("تفاصيل استيراد الحركات");
      detailsSheet.views = [{ rightToLeft: true }];

      detailsSheet.columns = [
        { header: "#", key: "index", width: 8 },
        { header: "معرّف السجل", key: "logId", width: 34 },
        { header: "المنفذ", key: "user", width: 20 },
        { header: "التاريخ", key: "date", width: 14 },
        { header: "الوقت", key: "time", width: 12 },
        { header: "اسم الشخص", key: "beneficiaryName", width: 28 },
        { header: "رقم البطاقة", key: "cardNumber", width: 24 },
        { header: "بطاقة العائلة الأساسية", key: "familyBaseCard", width: 24 },
        { header: "عدد أفراد العائلة", key: "familySize", width: 16 },
        { header: "الرصيد قبل الاستيراد", key: "balanceBefore", width: 20 },
        { header: "مقدار الخصم للفرد", key: "deductedAmount", width: 18 },
        { header: "الخصم المجمع للعائلة", key: "familyTotalDeduction", width: 20 },
        { header: "المتبقي بعد الاستيراد", key: "balanceAfter", width: 20 },
      ];

      detailsSheet.getRow(1).font = { bold: true, size: 12 };
      detailsSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

      importDetails.forEach((row, idx) => {
        detailsSheet.addRow({
          index: idx + 1,
          ...row,
        });
      });
    }

    if (bulkDetails.length > 0) {
      const detailsSheet = workbook.addWorksheet("تفاصيل العمليات الجماعية");
      detailsSheet.views = [{ rightToLeft: true }];

      detailsSheet.columns = [
        { header: "#", key: "index", width: 8 },
        { header: "معرّف السجل", key: "logId", width: 34 },
        { header: "العملية", key: "action", width: 28 },
        { header: "المنفذ", key: "user", width: 20 },
        { header: "التاريخ", key: "date", width: 14 },
        { header: "الوقت", key: "time", width: 12 },
        { header: "اسم المستفيد", key: "beneficiaryName", width: 28 },
        { header: "رقم البطاقة", key: "cardNumber", width: 24 },
        { header: "القيمة", key: "amount", width: 16 },
        { header: "قبل", key: "beforeValue", width: 24 },
        { header: "بعد", key: "afterValue", width: 24 },
        { header: "النتيجة", key: "result", width: 20 },
      ];

      detailsSheet.getRow(1).font = { bold: true, size: 12 };
      detailsSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

      bulkDetails.forEach((row, idx) => {
        detailsSheet.addRow({
          index: idx + 1,
          ...row,
        });
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="audit-log-report.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Audit log export failed", { error: String(error) });
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
