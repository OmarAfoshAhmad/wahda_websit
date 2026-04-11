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
      },
    });

    if (!job) {
      return new NextResponse("Import job not found", { status: 404 });
    }

    const skippedRows = (
      Array.isArray(job.skipped_rows_report) ? job.skipped_rows_report : []
    ) as SkippedImportRowReport[];

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
    summarySheet.addRow({ label: "مكررون / متخطون", value: job.duplicate_rows ?? 0 });
    summarySheet.addRow({ label: "فاشلون", value: job.failed_rows ?? 0 });

    // ورقة المكررين والمتخطين
    const skippedSheet = workbook.addWorksheet("المكررون والمتخطون");
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
