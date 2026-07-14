import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";
import { getLedgerRemainingByBeneficiaryIds } from "@/lib/ledger-balance";

type BeforeSnapshot = {
  id: string;
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
  beforeSnapshots?: BeforeSnapshot[];
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
    });

    if (!job) {
      return new NextResponse("Import job not found", { status: 404 });
    }

    const jobAny = job as unknown as Record<string, unknown>;
    const rollback = (jobAny.rollback_data ?? {}) as unknown as RollbackData;
    const createdIds = rollback.createdIds ?? [];
    const restoredIds = rollback.restoredIds ?? [];
    const beforeSnapshots = rollback.beforeSnapshots ?? [];

    // جمع كل IDs المتأثرة
    const allIds = [...new Set([...createdIds, ...restoredIds, ...beforeSnapshots.map((s) => s.id)])];

    if (allIds.length === 0) {
      return new NextResponse("No beneficiaries found for this import job", { status: 404 });
    }

    // جلب البيانات الحالية لجميع المستفيدين
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: allIds } },
      select: {
        id: true,
        name: true,
        card_number: true,
        birth_date: true,
        total_balance: true,
        status: true,
      },
    });

    const beneficiaryById = new Map(beneficiaries.map((b) => [b.id, b]));

    // حساب الرصيد المتبقي الفعلي (من دفتر الأستاذ)
    const remainingById = await getLedgerRemainingByBeneficiaryIds(allIds);

    // بناء خريطة snapshots قبل الاستيراد
    const snapshotById = new Map(beforeSnapshots.map((s) => [s.id, s]));

    // تجميع صفوف التقرير
    type ReportRow = {
      index: number;
      name: string;
      card_number: string;
      birth_date: string;
      type: string;
      balance_before: number;
      balance_after: number;
      remaining_now: number;
      status_before: string;
      status_after: string;
    };

    const STATUS_LABELS: Record<string, string> = {
      ACTIVE: "نشط",
      FINISHED: "مكتمل",
      SUSPENDED: "موقوف",
    };

    const rows: ReportRow[] = [];
    let idx = 0;

    for (const id of allIds) {
      const current = beneficiaryById.get(id);
      if (!current) continue;

      const snapshot = snapshotById.get(id);
      const isNew = createdIds.includes(id) && !snapshot;
      const isRestored = restoredIds.includes(id);

      let type = "جديد";
      if (isRestored) type = "مُستعاد";
      else if (snapshot && !isNew) type = "مُحدَّث";

      const balanceBefore = snapshot ? Number(snapshot.total_balance) : 0;
      const balanceAfter = Number(current.total_balance);
      const remainingNow = remainingById.get(id) ?? 0;
      const statusBefore = snapshot ? (STATUS_LABELS[snapshot.status] ?? snapshot.status) : "—";
      const statusAfter = STATUS_LABELS[current.status] ?? current.status;

      rows.push({
        index: ++idx,
        name: current.name,
        card_number: current.card_number,
        birth_date: current.birth_date ? formatDateTripoli(current.birth_date, "en-GB") : "—",
        type,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        remaining_now: remainingNow,
        status_before: statusBefore,
        status_after: statusAfter,
      });
    }

    // إنشاء ملف Excel
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
    summarySheet.addRow({ label: "وقت الانتهاء", value: completed ? formatTimeTripoli(completed, "ar-LY") : "—" });
    summarySheet.addRow({ label: "إجمالي الصفوف", value: job.total_rows ?? 0 });
    summarySheet.addRow({ label: "تمت إضافتهم", value: job.inserted_rows ?? 0 });
    summarySheet.addRow({ label: "مكررون / متخطون", value: job.duplicate_rows ?? 0 });
    summarySheet.addRow({ label: "عدد جدد", value: createdIds.length });
    summarySheet.addRow({ label: "عدد مستعادين", value: restoredIds.length });
    summarySheet.addRow({ label: "عدد محدّثين", value: rows.filter((r) => r.type === "مُحدَّث").length });

    // ورقة المستفيدين
    const dataSheet = workbook.addWorksheet("المستفيدون المستوردون");
    dataSheet.views = [{ rightToLeft: true }];
    dataSheet.columns = [
      { header: "#", key: "index", width: 6 },
      { header: "الاسم", key: "name", width: 34 },
      { header: "رقم البطاقة", key: "card_number", width: 22 },
      { header: "تاريخ الميلاد", key: "birth_date", width: 16 },
      { header: "النوع", key: "type", width: 14 },
      { header: "الرصيد قبل", key: "balance_before", width: 16 },
      { header: "الرصيد بعد", key: "balance_after", width: 16 },
      { header: "المتبقي حالياً", key: "remaining_now", width: 16 },
      { header: "الحالة قبل", key: "status_before", width: 14 },
      { header: "الحالة بعد", key: "status_after", width: 14 },
    ];

    const headerRow = dataSheet.getRow(1);
    headerRow.font = { bold: true, size: 12 };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };

    for (const row of rows) {
      dataSheet.addRow(row);
    }

    // تلوين حسب النوع
    dataSheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return;
      const typeCell = row.getCell("type");
      const typeVal = String(typeCell.value ?? "");
      if (typeVal === "جديد") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } };
        });
      } else if (typeVal === "مُستعاد") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E5F5" } };
        });
      } else if (typeVal === "مُحدَّث") {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
        });
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const dateStr = created.toISOString().slice(0, 10);

    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="import-beneficiaries-${dateStr}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Import beneficiaries report export failed", { error: String(error), jobId });
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
