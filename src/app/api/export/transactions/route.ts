import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start_date = searchParams.get("start_date");
  const end_date = searchParams.get("end_date");
  const facility_id = searchParams.get("facility_id");
  const q = searchParams.get("q");

  // نفس منطق الفلترة في صفحة الحركات
  const where: Record<string, any> = session.is_admin
    ? (facility_id ? { facility_id } : {})
    : { facility_id: session.id };

  if (q && q.trim() !== "") {
    where.OR = [
      { beneficiary: { name: { contains: q, mode: "insensitive" } } },
      { beneficiary: { card_number: { contains: q, mode: "insensitive" } } },
    ];
  }

  if (start_date || end_date) {
    where.created_at = {};
    if (start_date) {
      const start = new Date(start_date);
      if (!isNaN(start.getTime())) {
        where.created_at.gte = start;
      }
    }
    if (end_date) {
      const end = new Date(end_date);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        where.created_at.lte = end;
      }
    }
  }

  try {
    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { created_at: "desc" },
      include: {
        beneficiary: true,
        facility: true,
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Transactions");

    // تفعيل الاتجاه من اليمين لليسار
    worksheet.views = [{ rightToLeft: true }];

    // إعداد الأعمدة
    worksheet.columns = [
      { header: "رقم المعاملة", key: "id", width: 25 },
      { header: "اسم المستفيد", key: "beneficiary_name", width: 30 },
      { header: "رقم البطاقة", key: "card_number", width: 20 },
      { header: "القيمة (د.ل)", key: "amount", width: 15 },
      { header: "الرصيد المتبقي (د.ل)", key: "remaining_balance", width: 20 },
      { header: "نوع العملية", key: "type", width: 15 },
      { header: "التاريخ", key: "date", width: 15 },
      { header: "الوقت", key: "time", width: 15 },
      ...(session.is_admin ? [{ header: "المرفق", key: "facility_name", width: 30 }] : []),
    ];

    // تنسيق الصف الأول (Header)
    worksheet.getRow(1).font = { bold: true, size: 12 };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    // إضافة البيانات
    transactions.forEach((tx) => {
      worksheet.addRow({
        id: tx.id,
        beneficiary_name: tx.beneficiary.name,
        card_number: tx.beneficiary.card_number,
        amount: Number(tx.amount),
        remaining_balance: Number(tx.beneficiary.remaining_balance),
        type: tx.type === "MEDICINE" ? "ادوية صرف عام" : "كشف عام",
        date: new Date(tx.created_at).toLocaleDateString("en-GB"), // dd/mm/yyyy
        time: new Date(tx.created_at).toLocaleTimeString("en-GB"),
        ...(session.is_admin ? { facility_name: tx.facility.name } : {}),
      });
    });

    // حساب الإجماليات
    const totalAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
    const totalRemaining = transactions.reduce((sum, tx) => sum + Number(tx.beneficiary.remaining_balance), 0);

    // ملخص في النهاية
    worksheet.addRow([]);
    const totalRow = worksheet.addRow({
      beneficiary_name: "الإجمالي",
      amount: totalAmount,
      remaining_balance: totalRemaining,
    });
    totalRow.font = { bold: true };
    
    // تنسيق صف الإجمالي
    totalRow.getCell("amount").numFmt = "#,##0.00";
    totalRow.getCell("remaining_balance").numFmt = "#,##0.00";

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="transactions-report.xlsx"',
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
