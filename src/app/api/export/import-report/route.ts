import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";

type SkippedImportRowReport = {
  rowNumber: number | null;
  reason: string;
  reasonLabel: string;
  card_number: string;
  name: string;
  birth_date: string | null;
};

type BeneficiaryBeforeSnapshot = {
  id: string;
  card_number: string;
  name: string;
  birth_date: string | null;
  total_balance: string;
  remaining_balance: string;
  status: string;
  deleted_at: string | null;
};

type RollbackData = {
  createdIds?: string[];
  restoredIds?: string[];
  beforeSnapshots?: BeneficiaryBeforeSnapshot[];
};

const REASON_LABELS: Record<string, string> = {
  invalid_row: "صف غير صالح",
  missing_required_fields: "حقول مطلوبة مفقودة",
  duplicate_in_file: "مكرر في نفس الملف",
  already_exists: "موجود مسبقاً في النظام",
  duplicate_person: "شخص مكرر (الاسم والميلاد)",
};

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
  const jobId = searchParams.get("jobId")?.trim();

  if (!jobId) {
    return new NextResponse("jobId is required", { status: 400 });
  }

  try {
    const job = await prisma.importJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        created_by: true,
        total_rows: true,
        inserted_rows: true,
        duplicate_rows: true,
        failed_rows: true,
        status: true,
        created_at: true,
        completed_at: true,
        skipped_rows_report: true,
        rollback_data: true,
      },
    });

    if (!job) {
      return new NextResponse("Import job not found", { status: 404 });
    }

    let skippedRows: SkippedImportRowReport[] = [];
    let updatedRowsFromReport = 0;
    if (Array.isArray(job.skipped_rows_report)) {
      skippedRows = job.skipped_rows_report as unknown as SkippedImportRowReport[];
    } else if (job.skipped_rows_report && typeof job.skipped_rows_report === "object") {
      const report = job.skipped_rows_report as Record<string, unknown>;
      if (Array.isArray(report.rows)) {
        skippedRows = report.rows as unknown as SkippedImportRowReport[];
      }
      if (typeof report.updatedRows === "number") {
        updatedRowsFromReport = report.updatedRows;
      }
    }

    const rollback = (job.rollback_data && typeof job.rollback_data === "object")
      ? (job.rollback_data as unknown as RollbackData)
      : {};
    const createdIds = Array.isArray(rollback.createdIds) ? rollback.createdIds : [];
    const restoredIds = Array.isArray(rollback.restoredIds) ? rollback.restoredIds : [];
    const beforeSnapshots = Array.isArray(rollback.beforeSnapshots) ? rollback.beforeSnapshots : [];

    const importedIds = [...new Set([...createdIds, ...restoredIds])];
    const updatedIds = [...new Set(beforeSnapshots.map((s) => s.id).filter((id) => !restoredIds.includes(id)))];
    const impactedIds = [...new Set([...importedIds, ...updatedIds])];

    const currentRows = impactedIds.length > 0
      ? await prisma.beneficiary.findMany({
        where: { id: { in: impactedIds } },
        select: {
          id: true,
          card_number: true,
          name: true,
          birth_date: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          deleted_at: true,
        },
      })
      : [];
    const currentById = new Map(currentRows.map((r) => [r.id, r]));
    const beforeById = new Map(beforeSnapshots.map((s) => [s.id, s]));

    const workbook = new ExcelJS.Workbook();

    // ورقة الملخص
    const summarySheet = workbook.addWorksheet("الملخص");
    summarySheet.views = [{ rightToLeft: true }];
    summarySheet.columns = [
      { header: "البيان", key: "label", width: 28 },
      { header: "القيمة", key: "value", width: 18 },
    ];
    summarySheet.getRow(1).font = { bold: true, size: 12 };

    const created = new Date(job.created_at);
    const completed = job.completed_at ? new Date(job.completed_at) : null;

    summarySheet.addRow({ label: "معرّف المهمة", value: job.id });
    summarySheet.addRow({ label: "المنفذ", value: job.created_by });
    summarySheet.addRow({ label: "الحالة", value: job.status === "COMPLETED" ? "مكتملة" : job.status });
    summarySheet.addRow({ label: "تاريخ الاستيراد", value: formatDateTripoli(created, "en-GB") });
    summarySheet.addRow({ label: "وقت الاستيراد", value: formatTimeTripoli(created, "ar-LY") });
    summarySheet.addRow({ label: "وقت الانتهاء", value: completed ? formatTimeTripoli(completed, "ar-LY") : "-" });
    summarySheet.addRow({ label: "إجمالي الصفوف", value: job.total_rows ?? 0 });
    summarySheet.addRow({ label: "تمت إضافتهم", value: job.inserted_rows ?? 0 });
    summarySheet.addRow({ label: "تم تحديثهم", value: updatedRowsFromReport || updatedIds.length });
    summarySheet.addRow({ label: "فشل/تخطي", value: (job.duplicate_rows ?? 0) + (job.failed_rows ?? 0) });
    summarySheet.addRow({ label: "مكررون / متخطون", value: job.duplicate_rows ?? 0 });
    summarySheet.addRow({ label: "فاشلون", value: job.failed_rows ?? 0 });

    // ورقة الذين دخلوا (جدد + مستعادون)
    const importedSheet = workbook.addWorksheet("الذين دخلوا");
    importedSheet.views = [{ rightToLeft: true }];
    importedSheet.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "النوع", key: "importType", width: 16 },
      { header: "المعرف", key: "id", width: 30 },
      { header: "رقم البطاقة", key: "card_number", width: 22 },
      { header: "الاسم", key: "name", width: 32 },
      { header: "تاريخ الميلاد", key: "birth_date", width: 16 },
      { header: "الرصيد الكلي", key: "total_balance", width: 16 },
      { header: "الرصيد المتبقي", key: "remaining_balance", width: 16 },
      { header: "الحالة", key: "status", width: 14 },
    ];
    importedSheet.getRow(1).font = { bold: true, size: 12 };
    importedSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    const importedRows = importedIds.map((id) => {
      const current = currentById.get(id);
      return {
        id,
        importType: restoredIds.includes(id) ? "مستعاد" : "جديد",
        card_number: current?.card_number ?? "-",
        name: current?.name ?? "-",
        birth_date: current?.birth_date ? formatDateTripoli(current.birth_date, "en-GB") : "-",
        total_balance: current ? Number(current.total_balance) : "-",
        remaining_balance: current ? Number(current.remaining_balance) : "-",
        status: current?.status ?? "-",
      };
    });

    importedRows.forEach((row, idx) => {
      importedSheet.addRow({
        index: idx + 1,
        ...row,
      });
    });

    // ورقة المحدثين قبل/بعد
    const updatedSheet = workbook.addWorksheet("المحدثون قبل وبعد");
    updatedSheet.views = [{ rightToLeft: true }];
    updatedSheet.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "نوع التحديث", key: "updateType", width: 16 },
      { header: "المعرف", key: "id", width: 30 },
      { header: "البطاقة قبل", key: "before_card", width: 22 },
      { header: "البطاقة بعد", key: "after_card", width: 22 },
      { header: "الاسم قبل", key: "before_name", width: 30 },
      { header: "الاسم بعد", key: "after_name", width: 30 },
      { header: "الميلاد قبل", key: "before_birth", width: 16 },
      { header: "الميلاد بعد", key: "after_birth", width: 16 },
      { header: "المتبقي قبل", key: "before_remaining", width: 16 },
      { header: "المتبقي بعد", key: "after_remaining", width: 16 },
      { header: "الحالة قبل", key: "before_status", width: 14 },
      { header: "الحالة بعد", key: "after_status", width: 14 },
    ];
    updatedSheet.getRow(1).font = { bold: true, size: 12 };
    updatedSheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    const updatedRows = updatedIds.map((id) => {
      const before = beforeById.get(id);
      const current = currentById.get(id);
      return {
        id,
        updateType: "تحديث",
        before_card: before?.card_number ?? "-",
        after_card: current?.card_number ?? "-",
        before_name: before?.name ?? "-",
        after_name: current?.name ?? "-",
        before_birth: before?.birth_date ? formatDateTripoli(before.birth_date, "en-GB") : "-",
        after_birth: current?.birth_date ? formatDateTripoli(current.birth_date, "en-GB") : "-",
        before_remaining: before ? Number(before.remaining_balance) : "-",
        after_remaining: current ? Number(current.remaining_balance) : "-",
        before_status: before?.status ?? "-",
        after_status: current?.status ?? "-",
      };
    });

    updatedRows.forEach((row, idx) => {
      updatedSheet.addRow({
        index: idx + 1,
        ...row,
      });
    });

    // ورقة الذين فشل دخولهم (متخطون/فاشلون) مع الأسباب
    const skippedSheet = workbook.addWorksheet("الذين فشل دخولهم");
    skippedSheet.views = [{ rightToLeft: true }];
    skippedSheet.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "رقم الصف في الملف", key: "rowNumber", width: 20 },
      { header: "رقم البطاقة", key: "card_number", width: 22 },
      { header: "الاسم", key: "name", width: 32 },
      { header: "تاريخ الميلاد", key: "birth_date", width: 16 },
      { header: "سبب التخطي", key: "reason", width: 30 },
    ];

    const headerRow = skippedSheet.getRow(1);
    headerRow.font = { bold: true, size: 12 };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    skippedRows.forEach((row, idx) => {
      const reasonLabel = REASON_LABELS[row.reason] ?? row.reasonLabel ?? row.reason;
      skippedSheet.addRow({
        index: idx + 1,
        rowNumber: row.rowNumber ?? "-",
        card_number: row.card_number ?? "-",
        name: row.name ?? "-",
        birth_date: row.birth_date
          ? formatDateTripoli(row.birth_date, "en-GB")
          : "-",
        reason: reasonLabel,
      });
    });

    // تلوين الصفوف حسب السبب
    skippedSheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return;
      const reasonCell = row.getCell("reason");
      const reasonVal = String(reasonCell.value ?? "");
      if (reasonVal.includes("مكرر في نفس الملف") || reasonVal.includes("موجود مسبقاً")) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } };
        });
      } else if (reasonVal.includes("شخص مكرر")) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE8E6" } };
        });
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const dateStr = created.toISOString().slice(0, 10);

    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="import-report-${dateStr}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Import report export failed", { error: String(error), jobId });
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
