import { NextResponse } from "next/server";
import { hasPermission, requireActiveFacilitySession } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const canExport = session.is_admin || (session.is_manager && hasPermission(session, "export_data"));
  if (!canExport) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? undefined;
  const searchQuery = url.searchParams.get("q") ?? "";

  // الشروط: فقط مستفيدي الشركات (وليسوا تابعين للنظام القديم)
  const where: Prisma.BeneficiaryWhereInput = {
    deleted_at: null,
    is_legacy_card: false,
    company_id: { not: null }, // للتأكد أنهم تابعين لشركات التأمين
  };

  if (companyId) where.company_id = companyId;

  if (searchQuery) {
    where.OR = [
      { name: { contains: searchQuery, mode: "insensitive" } },
      { card_number: { contains: searchQuery, mode: "insensitive" } },
    ];
  }

  const beneficiaries = await prisma.beneficiary.findMany({
    where,
    orderBy: [{ company_id: "asc" }, { name: "asc" }],
    take: 20_000,
    select: {
      id: true,
      name: true,
      card_number: true,
      phone_number: true,
      city: true,
      batch_number: true,
      status: true,
      created_at: true,
      company: { select: { name: true, code: true } },
    },
  });

  // توليد ملف Excel
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("المستفيدين (أسنان)", { properties: { tabColor: { argb: "FF0D9488" } } });

  // رأس الجدول
  ws.columns = [
    { header: "اسم المستفيد", key: "name", width: 28 },
    { header: "رقم البطاقة", key: "card", width: 18 },
    { header: "شركة التأمين", key: "company", width: 24 },
    { header: "رقم الهاتف", key: "phone", width: 16 },
    { header: "المدينة", key: "city", width: 16 },
    { header: "رقم الدفعة", key: "batch", width: 16 },
    { header: "الحالة", key: "status", width: 16 },
    { header: "تاريخ الإضافة", key: "date", width: 20 },
  ];

  // تنسيق الرأس
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 22;

  const statusMap: Record<string, string> = {
    ACTIVE: "نشط",
    SUSPENDED: "موقوف",
    FINISHED: "منتهي",
  };

  // البيانات
  beneficiaries.forEach((b) => {
    ws.addRow({
      name: b.name ?? "—",
      card: b.card_number ?? "—",
      company: b.company ? `${b.company.name} (${b.company.code})` : "—",
      phone: b.phone_number ?? "—",
      city: b.city ?? "—",
      batch: b.batch_number ?? "—",
      status: statusMap[b.status] ?? b.status,
      date: new Intl.DateTimeFormat("ar-LY", {
        year: "numeric", month: "2-digit", day: "2-digit",
        timeZone: "Africa/Tripoli",
      }).format(new Date(b.created_at)),
    });
  });

  // تجميد الرأس
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // تصدير الملف
  const buffer = await workbook.xlsx.writeBuffer();
  const companyLabel = companyId
    ? (beneficiaries[0]?.company?.name ?? "شركة")
    : "جميع_الشركات";
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `مستفيدي_الأسنان_${companyLabel}_${dateStr}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
