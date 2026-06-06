import { NextResponse } from "next/server";
import { hasPermission, requireActiveFacilitySession } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

export async function GET(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const canExport = session.is_admin || hasPermission(session, "export_data");
  if (!canExport) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? undefined;
  const searchQuery = url.searchParams.get("q") ?? "";
  const fromDate = url.searchParams.get("from") ?? "";
  const toDate = url.searchParams.get("to") ?? "";

  // بناء الشروط
  const where: Prisma.TransactionWhereInput = {
    type: { not: "DENTAL" },
    company_id: {
      notIn: ["cmp7ha2km0000u9v8jse4ib5x"], // استثناء مصرف الوحدة
      not: null, // استثناء الحركات العامة بدون شركة
    },
    is_cancelled: false,
  };

  if (!session.is_admin) {
    // المدير لا يصدّر إلا بيانات مرفقه فقط.
    where.facility_id = session.id;
  }

  if (companyId) {
    where.company_id = companyId;
  }

  if (fromDate) {
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    where.created_at = { ...(where.created_at as object ?? {}), gte: from };
  }
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    where.created_at = { ...(where.created_at as object ?? {}), lte: to };
  }
  if (searchQuery) {
    where.OR = [
      { beneficiary: { name: { contains: searchQuery, mode: "insensitive" } } },
      { beneficiary: { card_number: { contains: searchQuery, mode: "insensitive" } } },
    ];
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: [{ company_id: "asc" }, { created_at: "desc" }],
    take: 10_000,
    select: {
      id: true,
      amount: true,
      actual_company_share: true,
      actual_patient_share: true,
      remaining_ceiling_after: true,
      created_at: true,
      beneficiary: { select: { name: true, card_number: true } },
      facility: { select: { name: true } },
      company: { select: { name: true, code: true } },
    },
  });

  // توليد ملف Excel
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("حركات شركات التأمين", { properties: { tabColor: { argb: "FF3B82F6" } } });

  // رأس الجدول
  ws.columns = [
    { header: "اسم المستفيد", key: "name", width: 28 },
    { header: "رقم البطاقة", key: "card", width: 18 },
    { header: "شركة التأمين", key: "company", width: 24 },
    { header: "قيمة الفاتورة", key: "amount", width: 16 },
    { header: "حصة الشركة", key: "company_share", width: 16 },
    { header: "حصة المؤمن", key: "patient_share", width: 16 },
    { header: "المتبقي بالسقف", key: "remaining", width: 18 },
    { header: "المرفق الصحي", key: "facility", width: 24 },
    { header: "التاريخ", key: "date", width: 20 },
  ];

  // تنسيق الرأس
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 22;

  // البيانات
  transactions.forEach((tx) => {
    ws.addRow({
      name: tx.beneficiary?.name ?? "—",
      card: tx.beneficiary?.card_number ?? "—",
      company: tx.company ? `${tx.company.name} (${tx.company.code})` : "—",
      amount: Number(tx.amount),
      company_share: tx.actual_company_share !== null ? Number(tx.actual_company_share) : "—",
      patient_share: tx.actual_patient_share !== null ? Number(tx.actual_patient_share) : "—",
      remaining: tx.remaining_ceiling_after !== null ? Number(tx.remaining_ceiling_after) : "مفتوح",
      facility: tx.facility?.name ?? "—",
      date: new Intl.DateTimeFormat("ar-LY", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
        timeZone: "Africa/Tripoli",
      }).format(new Date(tx.created_at)),
    });
  });

  // تنسيق أعمدة الأرقام
  ws.getColumn("amount").numFmt = "#,##0.00";
  ws.getColumn("company_share").numFmt = "#,##0.00";
  ws.getColumn("patient_share").numFmt = "#,##0.00";
  ws.getColumn("remaining").numFmt = "#,##0.00";

  // صف الإجمالي
  const totalRow = ws.addRow({
    name: "الإجمالي",
    card: "",
    company: "",
    amount: transactions.reduce((s, t) => s + Number(t.amount), 0),
    company_share: transactions.reduce((s, t) => s + (t.actual_company_share !== null ? Number(t.actual_company_share) : 0), 0),
    patient_share: transactions.reduce((s, t) => s + (t.actual_patient_share !== null ? Number(t.actual_patient_share) : 0), 0),
    remaining: "",
    facility: "",
    date: `${transactions.length} حركة`,
  });
  totalRow.font = { bold: true };
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDFB" } };

  // تجميد الرأس
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // تصدير الملف
  const buffer = await workbook.xlsx.writeBuffer();
  const companyLabel = companyId
    ? (transactions[0]?.company?.name ?? "شركة")
    : "جميع الشركات";
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `كشف_حركات_${companyLabel}_${dateStr}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
