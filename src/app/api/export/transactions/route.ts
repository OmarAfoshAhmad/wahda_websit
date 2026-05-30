import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireActiveFacilitySession } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getArabicSearchTerms } from "@/lib/search";
import { formatDateTripoli, formatTimeTripoli, getStartOfDayTripoli, getEndOfDayTripoli } from "@/lib/datetime";
import ExcelJS from "exceljs";

export async function GET(request: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const canExport = session.is_admin || hasPermission(session, "export_data");
  if (!canExport) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const rateLimitError = await checkRateLimit(`api:${session.id}`, "api");
  if (rateLimitError) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const start_date = searchParams.get("start_date");
  const end_date = searchParams.get("end_date");
  const batch_number = (searchParams.get("batch_number") ?? "").trim();
  const rawFacilityFilter = (searchParams.get("facility_id") ?? "").trim();
  const q = searchParams.get("q");
  const txIdsParam = (searchParams.get("tx_ids") ?? "").trim();
  const txIdList = searchParams.getAll("tx_id").map((id) => id.trim()).filter((id) => id.length > 0);
  const _page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const allowedPageSizes = [10, 25, 50, 100, 200];
  const requestedPageSize = Number.parseInt(searchParams.get("pageSize") ?? "10", 10);
  const _pageSize = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 10;
  const sort = searchParams.get("sort") ?? "created_at";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const source = searchParams.get("source") ?? "all";
  const statusFilter = searchParams.get("status") ?? "active";
  const txTypeFilter = searchParams.get("tx_type") ?? "all";
  const companyFilterId = (searchParams.get("company_id") ?? "").trim();

  const facilities = session.is_admin
    ? await prisma.facility.findMany({
      where: { deleted_at: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
    : [];
  const selectedFacility = facilities.find((f) => f.id === rawFacilityFilter || f.name === rawFacilityFilter);
  const resolvedFacilityId = session.is_admin ? selectedFacility?.id : session.id;

  // نفس منطق الفلترة في صفحة الحركات
  const where: Prisma.TransactionWhereInput = session.is_admin
    ? (resolvedFacilityId ? { facility_id: resolvedFacilityId } : {})
    : { facility_id: session.id };

  if (session.is_employee) {
    // الموظف: يرى فقط حركات الكاش التي نفذها حسابه، بدون الملغاة أو حركات التصحيح.
    where.type = { notIn: ["CANCELLATION", "SETTLEMENT"] };
    where.is_cancelled = false;
    where.idempotency_key = { startsWith: "cash-claim:" };
  } else {
    // بناءً على حالة statusFilter
    if (statusFilter === "active") {
      where.is_cancelled = false;
    } else if (statusFilter === "deleted") {
      where.is_cancelled = true;
    }
  }

  const canViewSettlement = session.is_admin || session.is_manager;
  if (!canViewSettlement) {
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existingAnd, { type: { not: "SETTLEMENT" } }];
  }

  // المصدر (يدوي / استيراد)
  if (session.is_admin && source === "import") {
    if (where.type) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { type: "IMPORT" }];
    } else {
      where.type = "IMPORT";
    }
  } else if (session.is_admin && source === "manual") {
    if (!where.type) {
      where.type = { in: ["MEDICINE", "SUPPLIES", "SETTLEMENT"] };
    }
  }

  const existingAndBase = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [
    ...existingAndBase,
    { type: { not: "DENTAL" } },
    {
      OR: [
        { company_id: "cmp7ha2km0000u9v8jse4ib5x" },
        { company_id: null }
      ]
    }
  ];

  if (txTypeFilter === "supplies") {
    where.AND.push({ type: "SUPPLIES" });
  } else if (txTypeFilter === "medicine") {
    where.AND.push({ type: { in: ["MEDICINE", "IMPORT"] } });
  }

  if (companyFilterId) {
    where.AND.push({ company_id: companyFilterId });
  }

  if (batch_number) {
    where.beneficiary = { ...where.beneficiary as object, batch_number };
  }

  if (q && q.trim() !== "") {
    where.AND.push({
      OR: getArabicSearchTerms(q.trim()).flatMap(t => [
        { beneficiary: { name: { contains: t, mode: "insensitive" as const } } },
        { beneficiary: { card_number: { contains: t, mode: "insensitive" as const } } },
      ])
    });
  }

  const TX_SORT_COLS = ["created_at", "amount", "beneficiary_name", "facility_name", "remaining_balance"] as const;
  type TxSortCol = typeof TX_SORT_COLS[number];
  const sortCol: TxSortCol = (TX_SORT_COLS as ReadonlyArray<string>).includes(sort) ? sort as TxSortCol : "created_at";
  const txOrderByMap: Record<TxSortCol, object> = {
    created_at: { created_at: order },
    amount: { amount: order },
    beneficiary_name: { beneficiary: { name: order } },
    facility_name: { facility: { name: order } },
    remaining_balance: { beneficiary: { remaining_balance: order } },
  };

  const txIds = txIdList.length > 0
    ? txIdList
    : (txIdsParam
      ? txIdsParam
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
      : []);

  if (txIds.length > 0) {
    where.id = { in: txIds };
  }

  // فلترة بالتاريخ (نفس منطق صفحة الحركات)
  const hasDateFilter = !!(start_date || end_date);
  if (hasDateFilter) {
    where.created_at = {};
    if (start_date) {
      const start = getStartOfDayTripoli(start_date);
      if (!isNaN(start.getTime())) {
        where.created_at.gte = start;
      }
    }
    if (end_date) {
      const end = getEndOfDayTripoli(end_date);
      if (!isNaN(end.getTime())) {
        where.created_at.lte = end;
      }
    }
    if (Object.keys(where.created_at).length === 0) {
      delete where.created_at;
    }
  }

  // حد أقصى لعدد السجلات المُصدَّرة لمنع استهلاك الذاكرة الزائد
  const EXPORT_LIMIT = 50_000;

  try {
    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: txOrderByMap[sortCol],
      take: EXPORT_LIMIT, // نحصل على جميع النتائج بدون skip
      include: {
        beneficiary: true,
        facility: true,
      },
    });

    const orderedTransactions = transactions;

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
    orderedTransactions.forEach((tx) => {
      worksheet.addRow({
        id: tx.id,
        beneficiary_name: tx.beneficiary.name,
        card_number: tx.beneficiary.card_number,
        amount: Number(tx.amount),
        remaining_balance: Number(tx.beneficiary.remaining_balance),
        type: tx.type === "SUPPLIES" ? "كشف عام" : "ادوية صرف عام",
        date: formatDateTripoli(tx.created_at, "en-GB"), // dd/mm/yyyy
        time: formatTimeTripoli(tx.created_at, "en-GB"),
        ...(session.is_admin ? { facility_name: tx.facility.name } : {}),
      });
    });

    // حساب الإجماليات
    const totalAmount = orderedTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0);

    // ملخص في النهاية
    worksheet.addRow([]);
    const totalRow = worksheet.addRow({
      beneficiary_name: "الإجمالي",
      amount: totalAmount,
    });
    totalRow.font = { bold: true };
    
    // تنسيق صف الإجمالي
    totalRow.getCell("amount").numFmt = "#,##0.00";

    const buffer = await workbook.xlsx.writeBuffer();

    try {
      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "EXPORT_TRANSACTIONS",
          metadata: {
            exported_count: orderedTransactions.length,
            source,
            start_date,
            end_date,
            q: q?.trim() || null,
            selected_facility_id: resolvedFacilityId ?? null,
            requested_facility_filter: rawFacilityFilter || null,
            tx_ids_count: txIds.length,
          },
        },
      });
    } catch (auditError) {
      logger.warn("EXPORT_TRANSACTIONS_AUDIT_FAILED", {
        facilityId: session.id,
        username: session.username,
        error: String(auditError),
      });
    }

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
