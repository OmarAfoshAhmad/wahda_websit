import { NextRequest, NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getArabicSearchTerms } from "@/lib/search";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";
import ExcelJS from "exceljs";

export async function GET(request: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const rateLimitError = await checkRateLimit(`api:${session.id}`, "api");
  if (rateLimitError) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const start_date = searchParams.get("start_date");
  const end_date = searchParams.get("end_date");
  const facility_id = searchParams.get("facility_id");
  const q = searchParams.get("q");

  // نفس منطق الفلترة في صفحة الحركات
  const where: Prisma.TransactionWhereInput = session.is_admin
    ? (facility_id ? { facility_id } : {})
    : { facility_id: session.id };

  // في التقرير: نظهر الحركات العادية المنفذة فقط ونستبعد الملغاة وحركة التصحيح.
  where.type = { not: "CANCELLATION" };
  where.is_cancelled = false;

  if (q && q.trim() !== "") {
    where.OR = getArabicSearchTerms(q.trim()).flatMap(t => [
      { beneficiary: { name: { contains: t, mode: "insensitive" as const } } },
      { beneficiary: { card_number: { contains: t, mode: "insensitive" as const } } },
    ]);
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

  // حد أقصى لعدد السجلات المُصدَّرة لمنع استهلاك الذاكرة الزائد
  const EXPORT_LIMIT = 50_000;

  try {
    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      take: EXPORT_LIMIT,
      include: {
        beneficiary: true,
        facility: true,
      },
    });

    const beneficiaryIds = [...new Set(transactions.map((tx) => tx.beneficiary_id))];
    const remainingByTxId = new Map<string, number>();

    if (beneficiaryIds.length > 0) {
      const [beneficiaryTotals, txHistory] = await Promise.all([
        prisma.beneficiary.findMany({
          where: { id: { in: beneficiaryIds } },
          select: { id: true, total_balance: true },
        }),
        prisma.transaction.findMany({
          where: {
            beneficiary_id: { in: beneficiaryIds },
            is_cancelled: false,
            type: { not: "CANCELLATION" },
          },
          select: {
            id: true,
            beneficiary_id: true,
            amount: true,
            created_at: true,
          },
          orderBy: [{ created_at: "asc" }, { id: "asc" }],
        }),
      ]);

      const runningByBeneficiary = new Map<string, number>(
        beneficiaryTotals.map((b) => [b.id, Number(b.total_balance)])
      );

      for (const tx of txHistory) {
        const current = runningByBeneficiary.get(tx.beneficiary_id) ?? 0;
        const next = current - Number(tx.amount);
        runningByBeneficiary.set(tx.beneficiary_id, next);
        remainingByTxId.set(tx.id, Math.max(0, next));
      }
    }

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
        remaining_balance: remainingByTxId.get(tx.id) ?? Number(tx.beneficiary.remaining_balance),
        type: tx.type === "SUPPLIES" ? "كشف عام" : "ادوية صرف عام",
        date: formatDateTripoli(tx.created_at, "en-GB"), // dd/mm/yyyy
        time: formatTimeTripoli(tx.created_at, "en-GB"),
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

    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="transactions-report.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Export failed", { error: String(error) });
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
