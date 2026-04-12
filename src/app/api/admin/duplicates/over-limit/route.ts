import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { roundCurrency } from "@/lib/money";

/**
 * يُصدّر تقرير Excel بالمستفيدين الذين تجاوز إجمالي حركاتهم الفردية 600 دينار.
 *
 * الحساب: مجموع مبالغ الحركات الفعلية (غير الملغاة وغير حركات الإلغاء)
 * لكل مستفيد على حدة. يظهر فقط من تجاوز 600 كفرد مستقل.
 */
export async function GET() {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المبرمجون فقط" }, { status: 403 });
  }

  const LIMIT = 600;

  // 1) جلب كل المستفيدين مع مجموع حركاتهم الفردية
  const allBeneficiaries = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
      card_number: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      transactions: {
        where: {
          is_cancelled: false,
          type: { not: "CANCELLATION" },
        },
        select: {
          id: true,
          amount: true,
          type: true,
          created_at: true,
          facility: { select: { name: true } },
        },
        orderBy: { created_at: "asc" },
      },
    },
    orderBy: { card_number: "asc" },
  });

  // 2) حساب إجمالي الاستهلاك لكل فرد وتصفية من تجاوز 600
  const overLimit = allBeneficiaries
    .map((b) => {
      const spent = roundCurrency(
        b.transactions.reduce((sum, tx) => sum + Number(tx.amount), 0)
      );
      return { ...b, spent };
    })
    .filter((b) => b.spent > LIMIT);

  // 3) بناء ملف Excel
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAAD";
  workbook.created = new Date();

  if (overLimit.length === 0) {
    const sheet = workbook.addWorksheet("النتيجة");
    sheet.views = [{ rightToLeft: true }];
    sheet.addRow(["لا يوجد مستفيدون تجاوزوا 600 دينار كاستهلاك فردي"]);
    const buf = await workbook.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="over-limit-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  }

  const statusLabels: Record<string, string> = {
    ACTIVE: "فعال",
    SUSPENDED: "موقوف",
    COMPLETED: "مكتمل",
    FINISHED: "مكتمل",
  };

  const typeLabels: Record<string, string> = {
    MEDICINE: "أدوية صرف عام",
    SUPPLIES: "كشف عام",
    IMPORT: "استيراد",
  };

  // --- ورقة الملخص ---
  const summarySheet = workbook.addWorksheet("متجاوزو الحد (600)");
  summarySheet.views = [{ rightToLeft: true }];
  summarySheet.columns = [
    { header: "#", key: "row_num", width: 6 },
    { header: "رقم البطاقة", key: "card_number", width: 24 },
    { header: "اسم المستفيد", key: "name", width: 32 },
    { header: "إجمالي استهلاك الفرد", key: "spent", width: 22 },
    { header: "الحد الأقصى للفرد", key: "limit", width: 20 },
    { header: "الزيادة عن الحد", key: "over", width: 18 },
    { header: "الرصيد الأصلي في النظام", key: "total_balance", width: 24 },
    { header: "الرصيد المتبقي في النظام", key: "remaining", width: 24 },
    { header: "الحالة", key: "status", width: 14 },
    { header: "عدد الحركات", key: "tx_count", width: 14 },
  ];

  const headerStyle: Partial<ExcelJS.Fill> = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDC2626" },
  };
  summarySheet.getRow(1).fill = headerStyle as ExcelJS.Fill;
  summarySheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  overLimit.forEach((b, i) => {
    summarySheet.addRow({
      row_num: i + 1,
      card_number: b.card_number,
      name: b.name,
      spent: b.spent,
      limit: LIMIT,
      over: roundCurrency(b.spent - LIMIT),
      total_balance: Number(b.total_balance),
      remaining: Number(b.remaining_balance),
      status: statusLabels[b.status] ?? b.status,
      tx_count: b.transactions.length,
    });
  });

  // --- ورقة تفاصيل الحركات ---
  const detailSheet = workbook.addWorksheet("تفاصيل حركات المتجاوزين");
  detailSheet.views = [{ rightToLeft: true }];
  detailSheet.columns = [
    { header: "رقم البطاقة", key: "card_number", width: 24 },
    { header: "اسم المستفيد", key: "name", width: 32 },
    { header: "# الحركة", key: "tx_num", width: 10 },
    { header: "مبلغ الحركة", key: "amount", width: 16 },
    { header: "النوع", key: "type", width: 18 },
    { header: "المرفق", key: "facility", width: 26 },
    { header: "التاريخ", key: "date", width: 14 },
    { header: "إجمالي استهلاك الفرد", key: "cumulative", width: 22 },
  ];

  const detailHeaderStyle: Partial<ExcelJS.Fill> = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2563EB" },
  };
  detailSheet.getRow(1).fill = detailHeaderStyle as ExcelJS.Fill;
  detailSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const b of overLimit) {
    let cumulative = 0;
    b.transactions.forEach((tx, i) => {
      const amount = Number(tx.amount);
      cumulative = roundCurrency(cumulative + amount);
      detailSheet.addRow({
        card_number: b.card_number,
        name: b.name,
        tx_num: i + 1,
        amount,
        type: typeLabels[tx.type] ?? tx.type,
        facility: tx.facility.name,
        date: tx.created_at.toISOString().slice(0, 10),
        cumulative,
      });
    });
  }

  const buf = await workbook.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="over-limit-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
