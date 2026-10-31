import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { canAccessAdmin } from "@/lib/permissions";
import { getAllowedCompanyIds } from "@/lib/company-scope";
import { buildDispenseWhere, DISPENSE_CATEGORIES, type DispenseFilterParams } from "@/lib/pharmacy/dispense-filter";
import { formatDateTripoli } from "@/lib/datetime";

const MAX_ROWS = 50_000;

/** تصدير حركات الصيدلية (نفس فلاتر الجدول) إلى Excel: صف لكل صرف، وبنوده في عمود. */
export async function GET(request: Request) {
  const session = await getSessionWithFreshPermissions();
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!canAccessAdmin(session) || (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries"))) return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  if (!session.is_admin && !hasPermission(session, "export_data")) return NextResponse.json({ error: "لا تملك صلاحية التصدير" }, { status: 403 });

  const params = Object.fromEntries(new URL(request.url).searchParams) as DispenseFilterParams;
  const { where, deletedView } = buildDispenseWhere(params, { allowedCompanyIds: await getAllowedCompanyIds(session), facilityId: null });
  const rows = await prisma.pharmacyDispense.findMany({
    where, orderBy: { created_at: "asc" }, take: MAX_ROWS,
    select: {
      id: true, created_at: true, medicine_category: true, gross_total: true, company_total: true, patient_total: true, cancelled_at: true, cancellation_reason: true,
      beneficiary: { select: { name: true, card_number: true } }, company: { select: { name: true } }, facility: { select: { name: true } },
      prescription: { select: { prescription_number: true } },
      items: { orderBy: { sequence: "asc" }, select: { price: true, drug: { select: { name: true } }, sequence: true } },
    },
  });

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(deletedView ? "الحركات المحذوفة" : "حركات الصيدلية", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "رقم الفاتورة", key: "number", width: 13 },
    { header: "التاريخ", key: "date", width: 18 },
    { header: "المستفيد", key: "name", width: 30 },
    { header: "رقم البطاقة", key: "card", width: 20 },
    { header: "الشركة", key: "company", width: 22 },
    { header: "الصيدلية", key: "facility", width: 24 },
    { header: "النوع", key: "category", width: 10 },
    { header: "رقم الوصفة", key: "rx", width: 10 },
    { header: "البنود", key: "items", width: 60 },
    { header: "الإجمالي", key: "gross", width: 12 },
    { header: "على الشركة", key: "company_share", width: 12 },
    { header: "على المستفيد", key: "patient_share", width: 12 },
    ...(deletedView ? [{ header: "تاريخ الحذف", key: "cancelled_at", width: 18 }, { header: "سبب الحذف", key: "reason", width: 30 }] : []),
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } };
  const when = (date: Date) => formatDateTripoli(date);
  for (const row of rows) {
    ws.addRow({
      number: row.id.slice(-8).toUpperCase(),
      date: when(row.created_at),
      name: row.beneficiary.name,
      card: row.beneficiary.card_number,
      company: row.company.name,
      facility: row.facility.name,
      category: DISPENSE_CATEGORIES[row.medicine_category],
      rx: row.prescription?.prescription_number ?? "",
      items: row.items.map((item) => `${item.drug?.name ?? `بند ${item.sequence}`} (${Number(item.price).toFixed(2)})`).join("، "),
      gross: Number(row.gross_total),
      company_share: Number(row.company_total),
      patient_share: Number(row.patient_total),
      cancelled_at: row.cancelled_at ? when(row.cancelled_at) : "",
      reason: row.cancellation_reason ?? "",
    });
  }
  for (const key of ["gross", "company_share", "patient_share"]) ws.getColumn(key).numFmt = "#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  await prisma.auditLog.create({
    data: { facility_id: session.id, user: session.username, action: "PHARMACY_TRANSACTIONS_EXPORT", metadata: { ...params, rows: rows.length } },
  }).catch(() => undefined);
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pharmacy-transactions${deletedView ? "-deleted" : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
