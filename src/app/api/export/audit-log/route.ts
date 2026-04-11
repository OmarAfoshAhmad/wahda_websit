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

const EXPORT_LIMIT = 50_000;

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

  if (action === "CREATE_FACILITY") {
    return `مرفق: ${String(m.name ?? "-")} · مستخدم: ${String(m.new_facility_username ?? "-")}`;
  }

  if (action === "IMPORT_FACILITIES") {
    return `تمت إضافة: ${String(m.created ?? "-")} · متخطاة: ${String(m.skipped ?? "-")}`;
  }

  if (action === "DELETE_FACILITY") {
    return `معرف المرفق: ${String(m.deleted_facility_id ?? "-")}`;
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

  const where = {
    ...(logId ? { id: logId } : {}),
    action: { in: TARGET_ACTIONS[target] },
    ...(actor ? { user: { contains: actor, mode: "insensitive" as const } } : {}),
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
