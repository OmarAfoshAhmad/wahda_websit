import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { hasPermission } from "@/lib/session-guard";
import { FAMILY_FILTERS, familyCte, filterSql, requirePharmacyStaff, type FamilyFilter, type HeadRow } from "@/lib/pharmacy/families";
import { formatDateTripoli } from "@/lib/datetime";

const FILTER_LABEL: Record<FamilyFilter, string> = {
  all: "كل الأسر", with_phone: "لديها هاتف", no_phone: "بلا هاتف", no_portal: "غير مسجلة في البوابة", chronic: "لديها مزمن", recent: "صرف خلال 30 يوما", never: "لم يصرف لها",
};

/**
 * تصدير أسر الصيدلية (نفس البحث والفلتر المعروضين) إلى Excel: صف لكل أسرة.
 * عمودا «رقم البطاقة» و«الهاتف» بنفس صيغة ملف استيراد الهواتف، فيُعبَّأ الملف ويُعاد رفعه مباشرة.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  const access = await requirePharmacyStaff(companyId, "read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: 403 });
  if (!access.session.is_admin && !hasPermission(access.session, "export_data")) return NextResponse.json({ error: "لا تملك صلاحية التصدير" }, { status: 403 });

  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const requested = url.searchParams.get("filter") as FamilyFilter | null;
  const filter: FamilyFilter = requested && FAMILY_FILTERS.includes(requested) ? requested : "all";

  const [company, rows] = await Promise.all([
    prisma.insuranceCompany.findUnique({ where: { id: companyId }, select: { name: true, code: true } }),
    prisma.$queryRaw<Array<HeadRow & { member_names: string | null }>>`
      WITH ${familyCte(companyId, search)}
      SELECT h.*, 0 AS total,
        (SELECT string_agg(m.name || ' (' || m.card_number || ')', '، ' ORDER BY m.card_number) FROM m WHERE m.fam = h.fam AND m.id <> h.head_id) AS member_names
      FROM h WHERE h.matched AND ${filterSql(filter)}
      ORDER BY h.card_number ASC
    `,
  ]);

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("الأسر", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "رقم البطاقة", key: "card", width: 20 },
    { header: "الهاتف", key: "phone", width: 16 },
    { header: "صاحب البطاقة", key: "name", width: 30 },
    { header: "عدد الأفراد", key: "members", width: 11 },
    { header: "الأفراد", key: "member_names", width: 60 },
    { header: "مسجلة في البوابة", key: "portal", width: 15 },
    { header: "أدوية مزمنة", key: "chronic", width: 12 },
    { header: "آخر صرف", key: "last", width: 14 },
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } };
  ws.getColumn("phone").numFmt = "@";
  for (const row of rows) {
    ws.addRow({
      card: row.card_number,
      phone: row.phone_number ?? "",
      name: row.name,
      members: row.members,
      member_names: row.member_names ?? "",
      portal: row.has_password ? "نعم" : "لا",
      chronic: row.chronic_count,
      last: row.last_dispense_at ? formatDateTripoli(row.last_dispense_at) : "",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const name = `pharmacy-families-${company?.code ?? "company"}-${filter}.xlsx`;
  await prisma.auditLog.create({
    data: { facility_id: access.session.id, user: access.session.username, action: "PHARMACY_FAMILIES_EXPORT", metadata: { company_id: companyId, filter, filter_label: FILTER_LABEL[filter], query: search, rows: rows.length } },
  }).catch(() => undefined);
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
