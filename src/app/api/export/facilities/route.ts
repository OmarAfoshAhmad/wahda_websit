import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import ExcelJS from "exceljs";
import { formatDateTripoli } from "@/lib/datetime";

export async function GET() {
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

  try {
    const facilities = await prisma.facility.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: "asc" },
      select: {
        name: true,
        username: true,
        is_admin: true,
        created_at: true,
        _count: { select: { transactions: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Facilities");

    worksheet.views = [{ rightToLeft: true }];

    worksheet.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "اسم المرفق", key: "name", width: 35 },
      { header: "اسم المستخدم", key: "username", width: 25 },
      { header: "النوع", key: "role", width: 15 },
      { header: "عدد العمليات", key: "transactions", width: 18 },
      { header: "تاريخ التسجيل", key: "created_at", width: 18 },
    ];

    worksheet.getRow(1).font = { bold: true, size: 12 };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    facilities.forEach((f, idx) => {
      worksheet.addRow({
        index: idx + 1,
        name: f.name,
        username: f.username,
        role: f.is_admin ? "المبرمج" : "مرفق",
        transactions: f._count.transactions,
         created_at: formatDateTripoli(f.created_at, "en-GB"),
      });
    });

    worksheet.addRow([]);
    const totalRow = worksheet.addRow({
      name: "الإجمالي",
      transactions: facilities.reduce((s, f) => s + f._count.transactions, 0),
    });
    totalRow.font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="facilities-report.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Facilities export failed", { error: String(error) });
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
