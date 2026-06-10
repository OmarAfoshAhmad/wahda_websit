import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getArabicSearchTerms } from "@/lib/search";
import { formatDateTripoli } from "@/lib/datetime";
import { getLedgerRemainingByBeneficiaryIds } from "@/lib/ledger-balance";

const EXPORT_LIMIT = 50_000;

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
  const q = searchParams.get("q")?.trim() ?? "";
  const view = searchParams.get("view");
  const statusParam = searchParams.get("status");
  const completedViaParam = searchParams.get("completed_via");
  const cardAgeParam = searchParams.get("card_age");
  const idsParam = (searchParams.get("ids") ?? "").trim();
  const idParams = searchParams.getAll("id");
  const isDeletedView = view === "deleted";
  const companyIdParam = searchParams.get("company_id")?.trim() ?? "";
  const isDental = searchParams.get("is_dental") === "1";

  const ALLOWED_STATUS = ["ACTIVE", "SUSPENDED", "FINISHED"] as const;
  const statusFilter = ALLOWED_STATUS.includes((statusParam ?? "") as (typeof ALLOWED_STATUS)[number])
    ? (statusParam as (typeof ALLOWED_STATUS)[number])
    : null;

  const ALLOWED_COMPLETED_VIA = ["MANUAL", "IMPORT"] as const;
  const completedViaFilter = ALLOWED_COMPLETED_VIA.includes((completedViaParam ?? "") as (typeof ALLOWED_COMPLETED_VIA)[number])
    ? (completedViaParam as (typeof ALLOWED_COMPLETED_VIA)[number])
    : null;

  const cardAgeFilter = cardAgeParam === "old" ? "old" : "all";

  const truthBirthParam = searchParams.get("truth_birth");
  const isTruthBirthSynced = truthBirthParam === "1";

  const selectedIds = Array.from(
    new Set(
      [
        ...idParams,
        ...(idsParam ? idsParam.split(",") : []),
      ]
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).slice(0, EXPORT_LIMIT);

  const hasExplicitSelection = selectedIds.length > 0;

  const companyCondition = companyIdParam
    ? { company_id: companyIdParam }
    : {
        OR: [
          { company_id: "cmp7ha2km0000u9v8jse4ib5x" },
          { company_id: null }
        ]
      };

  const where: any = hasExplicitSelection
    ? {
        id: { in: selectedIds },
        ...companyCondition
      }
    : {
        AND: [
          companyCondition,
          {
            ...(isDeletedView ? { deleted_at: { not: null } } : { deleted_at: null }),
            ...(!isDeletedView && statusFilter ? { status: statusFilter } : {}),
            ...(!isDeletedView && completedViaFilter ? { completed_via: completedViaFilter } : {}),
            ...(!isDeletedView && cardAgeFilter === "old" ? { is_legacy_card: true } : {}),
            ...(!isDeletedView && isTruthBirthSynced ? { birth_date_synced_from_truth: true, birth_date: { not: null } } : {}),
            ...(q
              ? {
                  OR: getArabicSearchTerms(q).flatMap(t => [
                    { name: { contains: t, mode: "insensitive" as const } },
                    { card_number: { contains: t, mode: "insensitive" as const } },
                  ]),
                }
              : {}),
          }
        ]
      };

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      orderBy: { created_at: "desc" },
      take: EXPORT_LIMIT,
      include: {
        _count: {
          select: {
            transactions: {
              where: isDental
                ? { company_id: companyIdParam, type: "DENTAL", is_cancelled: false }
                : { is_cancelled: false }
            }
          }
        },
      },
    });

    const beneficiaryIds = beneficiaries.map((b) => b.id);
    
    // Ledger balances for TPA/General beneficiaries
    const remainingById = isDental ? new Map<string, number>() : await getLedgerRemainingByBeneficiaryIds(beneficiaryIds);

    // Calculate spent dental ceiling per beneficiary in the current fiscal year
    let dentalCeiling: number | null = null;
    const spentDentalMap = new Map();

    if (isDental && companyIdParam) {
      const company = await prisma.insuranceCompany.findUnique({
        where: { id: companyIdParam },
        include: { service_policies: { include: { service_type: true } } }
      });
      if (company) {
        const dentalPolicy = (company as any).service_policies?.find((p: any) => p.service_type?.code === "DENTAL");
        dentalCeiling = dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null;
      }

      const fiscalYear = new Date().getFullYear();
      const startDate = new Date(fiscalYear, 0, 1);
      const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

      const spentDentalRows = beneficiaryIds.length > 0
        ? await prisma.transaction.findMany({
            where: {
              beneficiary_id: { in: beneficiaryIds },
              company_id: companyIdParam,
              type: "DENTAL",
              is_cancelled: false,
              created_at: { gte: startDate, lte: endDate },
            },
            select: {
              beneficiary_id: true,
              ceiling_consumed: true,
              actual_company_share: true,
              amount: true,
            }
          })
        : [];

      for (const tx of spentDentalRows) {
        const benId = tx.beneficiary_id;
        const consumed = tx.ceiling_consumed !== null
          ? Number(tx.ceiling_consumed)
          : Number(tx.actual_company_share ?? tx.amount);
        const deducted = tx.actual_company_share !== null
          ? Number(tx.actual_company_share)
          : Number(tx.amount);

        const existing = spentDentalMap.get(benId) ?? { consumed: 0, deducted: 0 };
        spentDentalMap.set(benId, {
          consumed: existing.consumed + consumed,
          deducted: existing.deducted + deducted,
        });
      }
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Beneficiaries");
    worksheet.views = [{ rightToLeft: true }];

    let totalColHeader = "الرصيد الكلي";
    let remainingColHeader = "الرصيد المتبقي";

    if (isDental) {
      if (dentalCeiling === null) {
        totalColHeader = "القيمة المخصومة";
        remainingColHeader = "الرصيد المستهلك";
      } else {
        totalColHeader = "الرصيد الكلي الابتدائي";
        remainingColHeader = "الرصيد المتبقي الحالي";
      }
    }

    // Set columns in Excel, swapping order for dental as requested by the user
    worksheet.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "الاسم", key: "name", width: 30 },
      { header: "رقم البطاقة", key: "card_number", width: 20 },
      { header: "تاريخ الميلاد", key: "birth_date", width: 16 },
      { header: "مرحل من جدول الحقيقة", key: "birth_date_synced_from_truth", width: 22 },
      { header: "الحالة", key: "status", width: 14 },
      ...(isDental
        ? [
            { header: remainingColHeader, key: "col1_balance", width: 20 },
            { header: totalColHeader, key: "col2_balance", width: 20 }
          ]
        : [
            { header: "الرصيد الكلي", key: "total_balance", width: 16 },
            { header: "الرصيد المتبقي", key: "remaining_balance", width: 16 }
          ]
      ),
      { header: "عدد الحركات", key: "transactions", width: 14 },
      { header: "تاريخ الإنشاء", key: "created_at", width: 16 },
      { header: "تاريخ الحذف", key: "deleted_at", width: 16 },
    ];

    worksheet.getRow(1).font = { bold: true, size: 12 };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

    const statusLabel = (status: string) => {
      if (status === "ACTIVE") return "نشط";
      if (status === "SUSPENDED") return "موقوف";
      if (status === "FINISHED") return "مكتمل";
      return status;
    };

    beneficiaries.forEach((b, idx) => {
      let totalBalance = Number(b.total_balance);
      let remainingBalance = remainingById.get(b.id) ?? Number(b.remaining_balance);
      let statusText = statusLabel(b.status);

      let col1Value: any = remainingBalance;
      let col2Value: any = totalBalance;

      if (isDental) {
        const stats = spentDentalMap.get(b.id) ?? { consumed: 0, deducted: 0 };
        const consumed = stats.consumed;
        const deducted = stats.deducted;

        remainingBalance = dentalCeiling === null ? consumed : Math.max(0, dentalCeiling - consumed);
        totalBalance = dentalCeiling === null ? deducted : dentalCeiling;

        const dynamicStatus = b.status === "SUSPENDED"
          ? "SUSPENDED"
          : (dentalCeiling !== null && Math.max(0, dentalCeiling - consumed) <= 0 ? "FINISHED" : "ACTIVE");
        
        statusText = statusLabel(dynamicStatus);

        // Swap balance values order to match swapped headers in Excel
        col1Value = dentalCeiling === null ? totalBalance : remainingBalance;
        col2Value = dentalCeiling === null ? remainingBalance : totalBalance;
      }

      const rowData: any = {
        index: idx + 1,
        name: b.name,
        card_number: b.card_number,
        birth_date: b.birth_date ? formatDateTripoli(b.birth_date, "en-GB") : "",
        birth_date_synced_from_truth: (b as any).birth_date_synced_from_truth ? "نعم" : "لا",
        status: statusText,
        transactions: b._count.transactions,
        created_at: formatDateTripoli(b.created_at, "en-GB"),
        deleted_at: b.deleted_at ? formatDateTripoli(b.deleted_at, "en-GB") : "",
      };

      if (isDental) {
        rowData.col1_balance = col1Value;
        rowData.col2_balance = col2Value;
      } else {
        rowData.total_balance = totalBalance;
        rowData.remaining_balance = remainingBalance;
      }

      worksheet.addRow(rowData);
    });

    const buffer = await workbook.xlsx.writeBuffer();

    const company = companyIdParam && isDental
      ? await prisma.insuranceCompany.findUnique({ where: { id: companyIdParam }, select: { name: true } })
      : null;
    const companyNameLabel = company?.name ? `_${company.name}` : "";
    const filename = isDental
      ? `مستفيدي_أسنان${companyNameLabel}_${isDeletedView ? "محذوفين" : "نشطين"}.xlsx`
      : `beneficiaries-${isDeletedView ? "deleted" : "active"}.xlsx`;

    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("Beneficiaries export failed", { error: String(error) });
    return new NextResponse("Failed to generate report", { status: 500 });
  }
}
