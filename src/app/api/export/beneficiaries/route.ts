import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getArabicSearchTerms } from "@/lib/search";

const EXPORT_LIMIT = 50_000;

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
  const q = searchParams.get("q")?.trim() ?? "";
  const view = searchParams.get("view");
  const statusParam = searchParams.get("status");
  const completedViaParam = searchParams.get("completed_via");
  const isDeletedView = view === "deleted";

  const ALLOWED_STATUS = ["ACTIVE", "SUSPENDED", "FINISHED"] as const;
  const statusFilter = ALLOWED_STATUS.includes((statusParam ?? "") as (typeof ALLOWED_STATUS)[number])
    ? (statusParam as (typeof ALLOWED_STATUS)[number])
    : null;

  const ALLOWED_COMPLETED_VIA = ["MANUAL", "IMPORT"] as const;
  const completedViaFilter = ALLOWED_COMPLETED_VIA.includes((completedViaParam ?? "") as (typeof ALLOWED_COMPLETED_VIA)[number])
    ? (completedViaParam as (typeof ALLOWED_COMPLETED_VIA)[number])
    : null;

  const where = {
    ...(isDeletedView ? { deleted_at: { not: null } } : { deleted_at: null }),
    ...(!isDeletedView && statusFilter ? { status: statusFilter } : {}),
    ...(!isDeletedView && completedViaFilter ? { completed_via: completedViaFilter } : {}),
    ...(q
      ? {
          OR: getArabicSearchTerms(q).flatMap(t => [
            { name: { contains: t, mode: "insensitive" as const } },
            { card_number: { contains: t, mode: "insensitive" as const } },
          ]),
        }
      : {}),
  };

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: EXPORT_LIMIT,
      include: {
        _count: { select: { transactions: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Beneficiaries");
    worksheet.views = [{ rightToLeft: true }];

    worksheet.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "الاسم", key: "name", width: 30 },
      { header: "رقم البطاقة", key: "card_number", width: 20 },
      { header: "تاريخ الميلاد", key: "birth_date", width: 16 },
      { header: "الحالة", key: "status", width: 14 },
      { header: "الرصيد الكلي", key: "total_balance", width: 16 },
      { header: "الرصيد المتبقي", key: "remaining_balance", width: 16 },
      { header: "عدد الحركات", key: "transactions", width: 14 },
      { header: "تاريخ الإنشاء", key: "created_at", width: 16 },
      { header: "تاريخ الحذف", key: "deleted_at", width: 16 },
    ];

    worksheet.getRow(1).font = { bold: true, size: 12 };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    const statusLabel = (status: string) => {
      if (status === "ACTIVE") return "نشط";
      if (status === "SUSPENDED") return "موقوف";
      if (status === "FINISHED") return "مكتمل";
      return status;
    };

    beneficiaries.forEach((b, idx) => {
      worksheet.addRow({
        index: idx + 1,
        name: b.name,
        card_number: b.card_number,
        birth_date: b.birth_date ? new Date(b.birth_date).toLocaleDateString("en-GB") : "",
        status: statusLabel(b.status),
        total_balance: Number(b.total_balance),
        remaining_balance: Number(b.remaining_balance),
        transactions: b._count.transactions,
        created_at: new Date(b.created_at).toLocaleDateString("en-GB"),
        deleted_at: b.deleted_at ? new Date(b.deleted_at).toLocaleDateString("en-GB") : "",
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="beneficiaries-${isDeletedView ? "deleted" : "active"}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Beneficiaries export failed", { error: String(error) });
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
