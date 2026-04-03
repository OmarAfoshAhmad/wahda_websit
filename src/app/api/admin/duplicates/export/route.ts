import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { buildDuplicateGroups } from "@/lib/duplicate-groups";

export async function GET(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المشرفون فقط" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const rows = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
      card_number: true,
      status: true,
      remaining_balance: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { card_number: "asc" },
  });

  const { zeroVariantGroups, sameNameGroups } = buildDuplicateGroups(rows, q);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAAD";
  workbook.created = new Date();

  const zeroSheet = workbook.addWorksheet("Zero Variants");
  zeroSheet.columns = [
    { header: "Canonical Card", key: "canonical", width: 26 },
    { header: "Beneficiary Name", key: "name", width: 28 },
    { header: "Card Number", key: "card_number", width: 26 },
    { header: "Keep", key: "keep", width: 10 },
    { header: "Status", key: "status", width: 18 },
    { header: "Transactions", key: "transactions", width: 14 },
    { header: "Remaining Balance", key: "balance", width: 18 },
  ];

  for (const group of zeroVariantGroups) {
    for (const member of group.members) {
      zeroSheet.addRow({
        canonical: group.canonical,
        name: member.name,
        card_number: member.card_number,
        keep: member.id === group.preferredId ? "YES" : "NO",
        status: member.status,
        transactions: member._count.transactions,
        balance: Number(member.remaining_balance),
      });
    }
  }

  const sameNameSheet = workbook.addWorksheet("Same Name Multi Cards");
  sameNameSheet.columns = [
    { header: "Normalized Name", key: "name_key", width: 30 },
    { header: "Displayed Name", key: "name", width: 28 },
    { header: "Card Number", key: "card_number", width: 26 },
    { header: "Status", key: "status", width: 18 },
    { header: "Transactions", key: "transactions", width: 14 },
    { header: "Remaining Balance", key: "balance", width: 18 },
  ];

  for (const group of sameNameGroups) {
    for (const member of group.members) {
      sameNameSheet.addRow({
        name_key: group.nameKey,
        name: member.name,
        card_number: member.card_number,
        status: member.status,
        transactions: member._count.transactions,
        balance: Number(member.remaining_balance),
      });
    }
  }

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 36 },
    { header: "Value", key: "value", width: 16 },
  ];
  summarySheet.addRow({ metric: "Search Query", value: q || "(none)" });
  summarySheet.addRow({ metric: "Zero Variant Groups", value: zeroVariantGroups.length });
  summarySheet.addRow({ metric: "Same Name Multi Card Groups", value: sameNameGroups.length });
  summarySheet.addRow({ metric: "Generated At", value: new Date().toISOString() });

  const buffer = await workbook.xlsx.writeBuffer();
  const fileDate = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const fileName = `duplicates-report-${fileDate}.xlsx`;

  return new NextResponse(buffer as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      "Cache-Control": "no-store",
    },
  });
}
