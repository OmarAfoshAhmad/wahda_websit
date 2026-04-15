import ExcelJS from "exceljs";
import { TransactionType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { roundCurrency } from "@/lib/money";

type MemberStatus = "ACTIVE" | "FINISHED" | "SUSPENDED";

type FamilyMemberShare = {
  memberId: string;
  memberName: string;
  memberCard: string;
  beforeRemaining: number;
  deductedAmount: number;
  afterRemaining: number;
  statusBefore: MemberStatus;
  statusAfter: MemberStatus;
  completedViaAfter: string | null;
};

export type OverdrawnDebtCase = {
  debtorId: string;
  debtorName: string;
  debtorCard: string;
  familyBaseCard: string;
  debtorTotalBalance: number;
  debtorSpent: number;
  debtorDebtAmount: number;
  familyMembersCount: number;
  familyAvailableTotal: number;
  plannedDistributed: number;
  residualDebtAfterDistribution: number;
  isSettled: boolean;
  shares: FamilyMemberShare[];
};

export type DebtSettlementRun = {
  auditId: string;
  beforeCases: OverdrawnDebtCase[];
  afterCases: OverdrawnDebtCase[];
  affectedDebtors: number;
  settledDebtors: number;
  unresolvedDebtors: number;
  affectedFamilyMembers: number;
  totalDebtBefore: number;
  totalDistributed: number;
  totalDebtAfter: number;
};

function extractFamilyBaseCard(cardNumber: string): string {
  const match = cardNumber.match(/^(.*?)([WSDMFHV])(\d+)$/i);
  return match ? match[1] : cardNumber;
}

function planSharesByAvailability(
  debtAmount: number,
  familyMembers: Array<{ id: string; name: string; card_number: string; status: MemberStatus; remaining: number }>
): FamilyMemberShare[] {
  const candidates = familyMembers
    .filter((m) => m.status === "ACTIVE" && m.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  let remainingDebt = roundCurrency(debtAmount);
  const shares: FamilyMemberShare[] = [];

  for (const member of candidates) {
    if (remainingDebt <= 0) break;
    const deduct = roundCurrency(Math.min(member.remaining, remainingDebt));
    if (deduct <= 0) continue;

    const afterRemaining = roundCurrency(member.remaining - deduct);
    const statusAfter: MemberStatus = afterRemaining <= 0 ? "FINISHED" : "ACTIVE";

    shares.push({
      memberId: member.id,
      memberName: member.name,
      memberCard: member.card_number,
      beforeRemaining: roundCurrency(member.remaining),
      deductedAmount: deduct,
      afterRemaining,
      statusBefore: member.status,
      statusAfter,
      completedViaAfter: statusAfter === "FINISHED" ? "EXCEEDED_BALANCE" : null,
    });

    remainingDebt = roundCurrency(remainingDebt - deduct);
  }

  return shares;
}

export async function getOverdrawnDebtCases(): Promise<OverdrawnDebtCase[]> {
  const [beneficiaries, spentRows] = await Promise.all([
    prisma.beneficiary.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        name: true,
        card_number: true,
        total_balance: true,
        status: true,
        completed_via: true,
      },
      orderBy: { card_number: "asc" },
    }),
    prisma.transaction.groupBy({
      by: ["beneficiary_id"],
      where: {
        is_cancelled: false,
        type: { not: TransactionType.CANCELLATION },
      },
      _sum: { amount: true },
    }),
  ]);

  const spentById = new Map(spentRows.map((r) => [r.beneficiary_id, roundCurrency(Number(r._sum.amount ?? 0))]));

  const beneficiaryById = new Map(
    beneficiaries.map((b) => [
      b.id,
      {
        ...b,
        totalBalance: roundCurrency(Number(b.total_balance)),
        spent: spentById.get(b.id) ?? 0,
      },
    ])
  );

  const remainingById = new Map<string, number>();
  for (const b of beneficiaries) {
    const totalBalance = roundCurrency(Number(b.total_balance));
    const spent = spentById.get(b.id) ?? 0;
    remainingById.set(b.id, roundCurrency(Math.max(0, totalBalance - spent)));
  }

  const membersByBaseCard = new Map<string, typeof beneficiaries>();
  for (const member of beneficiaries) {
    const base = extractFamilyBaseCard(member.card_number);
    const arr = membersByBaseCard.get(base) ?? [];
    arr.push(member);
    membersByBaseCard.set(base, arr);
  }

  const debtCases: OverdrawnDebtCase[] = [];

  for (const b of beneficiaries) {
    const enriched = beneficiaryById.get(b.id);
    if (!enriched) continue;

    // الحالة التي تمت تسويتها سابقا عبر توزيع مديونية الأسرة لا نعيد عرضها كحالة مشكلة.
    if (enriched.status === "FINISHED" && enriched.completed_via === "EXCEEDED_BALANCE") {
      continue;
    }

    const debtAmount = roundCurrency(enriched.spent - enriched.totalBalance);
    if (debtAmount <= 0) continue;

    const baseCard = extractFamilyBaseCard(enriched.card_number);
    const allFamilyMembers = membersByBaseCard.get(baseCard) ?? [];

    const familyMembers = allFamilyMembers
      .filter((m) => m.id !== enriched.id)
      .map((m) => ({
        id: m.id,
        name: m.name,
        card_number: m.card_number,
        status: m.status,
        remaining: remainingById.get(m.id) ?? 0,
      }));

    const familyAvailableTotal = roundCurrency(
      familyMembers
        .filter((m) => m.status === "ACTIVE" && m.remaining > 0)
        .reduce((sum, m) => sum + m.remaining, 0)
    );

    const shares = planSharesByAvailability(debtAmount, familyMembers);
    const plannedDistributed = roundCurrency(shares.reduce((sum, s) => sum + s.deductedAmount, 0));
    const residualDebtAfterDistribution = roundCurrency(Math.max(0, debtAmount - plannedDistributed));

    debtCases.push({
      debtorId: enriched.id,
      debtorName: enriched.name,
      debtorCard: enriched.card_number,
      familyBaseCard: baseCard,
      debtorTotalBalance: enriched.totalBalance,
      debtorSpent: enriched.spent,
      debtorDebtAmount: debtAmount,
      // نعرض العدد الكلي لأفراد الأسرة شاملاً صاحب البطاقة/المدين نفسه.
      familyMembersCount: allFamilyMembers.length,
      familyAvailableTotal,
      plannedDistributed,
      residualDebtAfterDistribution,
      isSettled: residualDebtAfterDistribution <= 0,
      shares,
    });
  }

  return debtCases.sort((a, b) => b.debtorDebtAmount - a.debtorDebtAmount);
}

export async function applyOverdrawnDebtSettlement(params: {
  user: string;
  facilityId?: string | null;
}): Promise<DebtSettlementRun> {
  const beforeCases = await getOverdrawnDebtCases();

  const requestedFacilityId = typeof params.facilityId === "string" ? params.facilityId.trim() : "";
  let effectiveFacilityId: string | null = null;

  if (requestedFacilityId) {
    const directFacility = await prisma.facility.findFirst({
      where: { id: requestedFacilityId, deleted_at: null },
      select: { id: true },
    });
    if (directFacility) {
      effectiveFacilityId = directFacility.id;
    }
  }

  if (!effectiveFacilityId) {
    const fallbackFacility = await prisma.facility.findFirst({
      where: { deleted_at: null },
      select: { id: true },
      orderBy: { created_at: "asc" },
    });

    if (!fallbackFacility) {
      throw new Error("لا يوجد مرفق صالح لتسجيل حركة التوزيع");
    }

    effectiveFacilityId = fallbackFacility.id;
  }

  let affectedFamilyMembers = 0;

  await prisma.$transaction(async (tx) => {
    for (const c of beforeCases) {
      if (c.shares.length === 0) continue;

      // لا نعلّم المدين "مكتمل" إلا إذا تمت تغطية الدين بالكامل.
      if (c.isSettled) {
        await tx.beneficiary.update({
          where: { id: c.debtorId },
          data: {
            status: "FINISHED",
            completed_via: "EXCEEDED_BALANCE",
            remaining_balance: 0,
          },
        });
      }

      for (const share of c.shares) {
        await tx.transaction.create({
          data: {
            beneficiary_id: share.memberId,
            facility_id: effectiveFacilityId,
            amount: share.deductedAmount,
            type: TransactionType.IMPORT,
          },
        });

        await tx.beneficiary.update({
          where: { id: share.memberId },
          data: {
            remaining_balance: share.afterRemaining,
            status: share.statusAfter,
            completed_via: share.completedViaAfter,
          },
        });

        affectedFamilyMembers += 1;
      }
    }
  });

  const afterCases = await getOverdrawnDebtCases();

  const totalDebtBefore = roundCurrency(beforeCases.reduce((sum, c) => sum + c.debtorDebtAmount, 0));
  const totalDistributed = roundCurrency(beforeCases.reduce((sum, c) => sum + c.plannedDistributed, 0));
  const totalDebtAfter = roundCurrency(afterCases.reduce((sum, c) => sum + c.debtorDebtAmount, 0));
  const settledDebtors = beforeCases.filter((c) => c.isSettled).length;
  const unresolvedDebtors = Math.max(0, beforeCases.length - settledDebtors);

  const audit = await prisma.auditLog.create({
    data: {
      facility_id: effectiveFacilityId,
      user: params.user,
      action: "SETTLE_OVERDRAWN_FAMILY_DEBT",
      metadata: {
        summary: {
          affectedDebtors: beforeCases.length,
          settledDebtors,
          unresolvedDebtors,
          affectedFamilyMembers,
          totalDebtBefore,
          totalDistributed,
          totalDebtAfter,
        },
        beforeCases,
        afterCases,
      },
    },
    select: { id: true },
  });

  return {
    auditId: audit.id,
    beforeCases,
    afterCases,
    affectedDebtors: beforeCases.length,
    settledDebtors,
    unresolvedDebtors,
    affectedFamilyMembers,
    totalDebtBefore,
    totalDistributed,
    totalDebtAfter,
  };
}

export async function exportOverdrawnDebtCasesExcel(cases: OverdrawnDebtCase[], title: string): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAAD";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("ملخص الحالات");
  summarySheet.views = [{ rightToLeft: true }];
  summarySheet.columns = [
    { header: "#", key: "idx", width: 6 },
    { header: "المستفيد المدين", key: "debtorName", width: 30 },
    { header: "رقم البطاقة", key: "debtorCard", width: 24 },
    { header: "إجمالي الصرف", key: "spent", width: 16 },
    { header: "الرصيد الكلي", key: "total", width: 14 },
    { header: "المبلغ المدين", key: "debt", width: 16 },
    { header: "إجمالي المتاح بالعائلة", key: "familyAvailable", width: 20 },
    { header: "المبلغ الموزع", key: "distributed", width: 16 },
    { header: "المتبقي مدين", key: "residual", width: 16 },
    { header: "الحالة بعد التوزيع", key: "state", width: 18 },
  ];

  summarySheet.getRow(1).font = { bold: true };

  cases.forEach((c, idx) => {
    summarySheet.addRow({
      idx: idx + 1,
      debtorName: c.debtorName,
      debtorCard: c.debtorCard,
      spent: c.debtorSpent,
      total: c.debtorTotalBalance,
      debt: c.debtorDebtAmount,
      familyAvailable: c.familyAvailableTotal,
      distributed: c.plannedDistributed,
      residual: c.residualDebtAfterDistribution,
      state: c.isSettled ? "تم التوافق" : "ما زال مدين",
    });
  });

  const detailSheet = workbook.addWorksheet("تفاصيل التأثير على الأسرة");
  detailSheet.views = [{ rightToLeft: true }];
  detailSheet.columns = [
    { header: "المستفيد المدين", key: "debtorName", width: 30 },
    { header: "بطاقة المدين", key: "debtorCard", width: 24 },
    { header: "المتأثر", key: "memberName", width: 30 },
    { header: "بطاقة المتأثر", key: "memberCard", width: 24 },
    { header: "الرصيد قبل", key: "before", width: 14 },
    { header: "المبلغ المخصوم", key: "deducted", width: 16 },
    { header: "الرصيد بعد", key: "after", width: 14 },
    { header: "الحالة قبل", key: "statusBefore", width: 12 },
    { header: "الحالة بعد", key: "statusAfter", width: 12 },
    { header: "اكتمال عبر", key: "completedViaAfter", width: 18 },
  ];
  detailSheet.getRow(1).font = { bold: true };

  for (const c of cases) {
    if (c.shares.length === 0) {
      detailSheet.addRow({
        debtorName: c.debtorName,
        debtorCard: c.debtorCard,
        memberName: "لا يوجد متأثرون",
        memberCard: "-",
        before: 0,
        deducted: 0,
        after: 0,
        statusBefore: "-",
        statusAfter: "-",
        completedViaAfter: "-",
      });
      continue;
    }

    for (const share of c.shares) {
      detailSheet.addRow({
        debtorName: c.debtorName,
        debtorCard: c.debtorCard,
        memberName: share.memberName,
        memberCard: share.memberCard,
        before: share.beforeRemaining,
        deducted: share.deductedAmount,
        after: share.afterRemaining,
        statusBefore: share.statusBefore,
        statusAfter: share.statusAfter,
        completedViaAfter: share.completedViaAfter ?? "-",
      });
    }
  }

  const infoSheet = workbook.addWorksheet("معلومات");
  infoSheet.views = [{ rightToLeft: true }];
  infoSheet.columns = [
    { header: "العنوان", key: "title", width: 24 },
    { header: "القيمة", key: "value", width: 60 },
  ];
  infoSheet.addRow({ title: "نوع التقرير", value: title });
  infoSheet.addRow({ title: "تاريخ الإنشاء", value: new Date().toISOString() });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
