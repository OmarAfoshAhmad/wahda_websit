import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { getLedgerRemainingByBeneficiaryIds } from "@/lib/ledger-balance";
import { buildDuplicateGroups } from "@/lib/duplicate-groups";

export async function GET(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المبرمجون فقط" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  const rows = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
      card_number: true,
      birth_date: true,
      status: true,
      total_balance: true,
      remaining_balance: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { card_number: "asc" },
  });

  const remainingById = await getLedgerRemainingByBeneficiaryIds(rows.map((row) => row.id));
  const enrichedRows = rows.map((row) => ({
    ...row,
    remaining_balance: remainingById.get(row.id) ?? 0,
  }));

  const { zeroVariantGroups, sameNameGroups: rawSameNameGroups, needsReviewZeroVariants } = buildDuplicateGroups(enrichedRows, q);

  // مطابقة منطق صفحة إدارة التكرارات: استبعاد مجموعات "نفس الاسم"
  // التي تم تجاهلها يدويًا عبر IGNORE_DUPLICATE_PAIR.
  const ignoreLogs = await prisma.auditLog.findMany({
    where: { action: "IGNORE_DUPLICATE_PAIR" },
    select: { metadata: true },
  });
  const ignoredPairKeys = new Set<string>();
  for (const log of ignoreLogs) {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const ignoreIds = Array.isArray(meta.ignore_ids)
      ? meta.ignore_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (ignoreIds.length > 0) {
      const sortedIds = [...ignoreIds].sort();
      ignoredPairKeys.add(sortedIds.join("-"));
    }
  }
  const sameNameGroups = rawSameNameGroups.filter((g) => {
    if (g.members.length < 2) return true;
    const ids = g.members.map((m) => m.id).sort();
    return !ignoredPairKeys.has(ids.join("-"));
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAAD";
  workbook.created = new Date();

  const readySheet = workbook.addWorksheet("جاهزة للدمج");
  readySheet.columns = [
    { header: "Canonical Card", key: "canonical", width: 26 },
    { header: "Beneficiary Name", key: "name", width: 28 },
    { header: "Card Number", key: "card_number", width: 26 },
    { header: "Birth Date", key: "birth_date", width: 14 },
    { header: "Keep", key: "keep", width: 10 },
    { header: "Status", key: "status", width: 18 },
    { header: "Transactions", key: "transactions", width: 14 },
    { header: "Remaining Balance", key: "balance", width: 18 },
  ];

  for (const group of zeroVariantGroups) {
    for (const member of group.members) {
      readySheet.addRow({
        canonical: group.canonical,
        name: member.name,
        card_number: member.card_number,
        birth_date: member.birth_date ? member.birth_date.toISOString().slice(0, 10) : "",
        keep: member.id === group.preferredId ? "YES" : "NO",
        status: member.status,
        transactions: member._count?.transactions ?? 0,
        balance: Number(member.remaining_balance),
      });
    }
  }

  const auditZeroSheet = workbook.addWorksheet("تدقيق-اختلاف الأصفار");
  auditZeroSheet.columns = [
    { header: "Canonical Card", key: "canonical", width: 26 },
    { header: "Beneficiary Name", key: "name", width: 28 },
    { header: "Card Number", key: "card_number", width: 26 },
    { header: "Birth Date", key: "birth_date", width: 14 },
    { header: "Keep", key: "keep", width: 10 },
    { header: "Status", key: "status", width: 18 },
    { header: "Transactions", key: "transactions", width: 14 },
    { header: "Remaining Balance", key: "balance", width: 18 },
    { header: "Audit Type", key: "audit_type", width: 26 },
  ];

  for (const group of needsReviewZeroVariants) {
    for (const member of group.members) {
      auditZeroSheet.addRow({
        canonical: group.canonical,
        name: member.name,
        card_number: member.card_number,
        birth_date: member.birth_date ? member.birth_date.toISOString().slice(0, 10) : "",
        keep: member.id === group.preferredId ? "YES" : "NO",
        status: member.status,
        transactions: member._count?.transactions ?? 0,
        balance: Number(member.remaining_balance),
        audit_type: "ZERO_VARIANT_NAME_MISMATCH",
      });
    }
  }

  const sameNameSheet = workbook.addWorksheet("تدقيق-نفس الاسم");
  sameNameSheet.columns = [
    { header: "Normalized Name", key: "name_key", width: 30 },
    { header: "Displayed Name", key: "name", width: 28 },
    { header: "Card Number", key: "card_number", width: 26 },
    { header: "Birth Date", key: "birth_date", width: 14 },
    { header: "Birth Date Conflict", key: "birth_conflict", width: 20 },
    { header: "Keep", key: "keep", width: 10 },
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
        birth_date: member.birth_date ? member.birth_date.toISOString().slice(0, 10) : "",
        birth_conflict: group.hasBirthDateConflict ? "YES" : "NO",
        keep: member.id === group.preferredId ? "YES" : "NO",
        status: member.status,
        transactions: member._count?.transactions ?? 0,
        balance: Number(member.remaining_balance),
      });
    }
  }

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
