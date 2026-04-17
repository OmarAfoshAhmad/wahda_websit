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

const DEBT_SETTLE_IDEMPOTENCY_PREFIX = "DEBT_SETTLE";

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
  const match = cardNumber.match(/^(.*?)([WSDMFHV])(\d*)$/i);
  return match ? match[1] : cardNumber;
}

function planSharesByAvailability(
  debtAmount: number,
  familyMembers: Array<{ id: string; name: string; card_number: string; status: MemberStatus; remaining: number }>
): FamilyMemberShare[] {
  const candidates = familyMembers
    .filter((m) => m.status === "ACTIVE" && m.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);

  const normalizedDebt = roundCurrency(Math.max(0, debtAmount));
  let remainingDebt = normalizedDebt;
  const shares: FamilyMemberShare[] = [];

  if (candidates.length === 0 || normalizedDebt <= 0) return shares;

  // التوزيع الأساسي: حصة متساوية لكل فرد (بنفس النسبة)
  const baseShare = Math.floor(normalizedDebt / candidates.length);
  const remainder = Math.max(0, Math.round(normalizedDebt - baseShare * candidates.length));

  const allocated = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    const member = candidates[i];
    const target = i === 0 ? baseShare + remainder : baseShare;
    const firstDeduct = roundCurrency(Math.min(member.remaining, target));
    allocated.set(member.id, firstDeduct);
    remainingDebt = roundCurrency(remainingDebt - firstDeduct);
  }

  // إعادة توزيع المتبقي على من يملك سعة إضافية
  if (remainingDebt > 0) {
    for (const member of candidates) {
      if (remainingDebt <= 0) break;
      const current = allocated.get(member.id) ?? 0;
      const extraCapacity = roundCurrency(Math.max(0, member.remaining - current));
      if (extraCapacity <= 0) continue;
      const extra = roundCurrency(Math.min(extraCapacity, remainingDebt));
      allocated.set(member.id, roundCurrency(current + extra));
      remainingDebt = roundCurrency(remainingDebt - extra);
    }
  }

  for (const member of candidates) {
    const deduct = roundCurrency(allocated.get(member.id) ?? 0);
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

  }

  return shares;
}

export async function getOverdrawnDebtCases(): Promise<OverdrawnDebtCase[]> {
  // استعلام SQL مُحسَّن: يجلب فقط المستفيدين الذين تجاوزوا رصيدهم
  // مع كامل مجموعاتهم العائلية — بدلاً من جلب كل المستفيدين في الذاكرة
  const debtorRows = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    card_number: string;
    total_balance: number;
    status: string;
    completed_via: string | null;
    spent: number;
  }>>`
    SELECT
      b.id,
      b.name,
      b.card_number,
      b.total_balance::float8,
      b.status::text,
      b.completed_via,
      COALESCE(SUM(t.amount), 0)::float8 AS spent
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t
      ON t.beneficiary_id = b.id
      AND t.is_cancelled = false
      AND t.type <> 'CANCELLATION'
    WHERE b.deleted_at IS NULL
      AND NOT (b.status = 'FINISHED' AND b.completed_via = 'EXCEEDED_BALANCE')
    GROUP BY b.id, b.name, b.card_number, b.total_balance, b.status, b.completed_via
    HAVING COALESCE(SUM(t.amount), 0) > b.total_balance
    ORDER BY b.card_number
  `;

  if (debtorRows.length === 0) return [];

  const debtorIds = debtorRows.map((row) => row.id);

  // تتبع ما تم توزيعه سابقًا لكل مدين/فرد عبر idempotency_key
  const priorSettlementRows = debtorIds.length > 0
    ? await prisma.$queryRaw<Array<{
        debtor_id: string;
        member_id: string;
        distributed_amount: number;
      }>>`
        SELECT
          split_part(t.idempotency_key, ':', 2) AS debtor_id,
          split_part(t.idempotency_key, ':', 3) AS member_id,
          COALESCE(SUM(t.amount), 0)::float8 AS distributed_amount
        FROM "Transaction" t
        WHERE t.is_cancelled = false
          AND t.type = 'IMPORT'
          AND t.idempotency_key IS NOT NULL
          AND t.idempotency_key LIKE ${`${DEBT_SETTLE_IDEMPOTENCY_PREFIX}:%`}
          AND split_part(t.idempotency_key, ':', 2) = ANY(${debtorIds}::text[])
        GROUP BY split_part(t.idempotency_key, ':', 2), split_part(t.idempotency_key, ':', 3)
      `
    : [];

  const priorDistributedByDebtor = new Map<string, number>();
  const priorDistributedMemberByDebtor = new Map<string, Set<string>>();
  for (const row of priorSettlementRows) {
    const amount = roundCurrency(Number(row.distributed_amount) || 0);
    priorDistributedByDebtor.set(
      row.debtor_id,
      roundCurrency((priorDistributedByDebtor.get(row.debtor_id) ?? 0) + amount),
    );
    if (!priorDistributedMemberByDebtor.has(row.debtor_id)) {
      priorDistributedMemberByDebtor.set(row.debtor_id, new Set());
    }
    priorDistributedMemberByDebtor.get(row.debtor_id)!.add(row.member_id);
  }

  // استخرج بادئات البطاقات العائلية لجلب الأفراد المرتبطين
  const familyBasePrefixes = [...new Set(
    debtorRows.map((b) => extractFamilyBaseCard(b.card_number))
  )];

  // جلب جميع أفراد العائلات المرتبطة بالمدينين (استعلام واحد فقط)
  const familyRows = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    card_number: string;
    total_balance: number;
    status: string;
    completed_via: string | null;
    spent: number;
  }>>`
    SELECT
      b.id,
      b.name,
      b.card_number,
      b.total_balance::float8,
      b.status::text,
      b.completed_via,
      COALESCE(SUM(t.amount), 0)::float8 AS spent
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t
      ON t.beneficiary_id = b.id
      AND t.is_cancelled = false
      AND t.type <> 'CANCELLATION'
    WHERE b.deleted_at IS NULL
      AND b.card_number ~ ${`^(${familyBasePrefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})([WSDMFHV]\\d*)?$`}
    GROUP BY b.id, b.name, b.card_number, b.total_balance, b.status, b.completed_via
    ORDER BY b.card_number
  `;

  // بناء خرائط الأفراد والأرصدة
  const allRows = familyRows;
  const remainingById = new Map<string, number>();
  for (const b of allRows) {
    const totalBalance = roundCurrency(b.total_balance);
    const spent = roundCurrency(b.spent);
    remainingById.set(b.id, roundCurrency(Math.max(0, totalBalance - spent)));
  }

  const membersByBaseCard = new Map<string, typeof allRows>();
  for (const b of allRows) {
    const base = extractFamilyBaseCard(b.card_number);
    const arr = membersByBaseCard.get(base) ?? [];
    arr.push(b);
    membersByBaseCard.set(base, arr);
  }

  const debtCases: OverdrawnDebtCase[] = [];

  for (const b of debtorRows) {
    const totalBalance = roundCurrency(b.total_balance);
    const spent = roundCurrency(b.spent);
    const debtAmountRaw = roundCurrency(spent - totalBalance);
    if (debtAmountRaw <= 0) continue;

    const alreadyDistributed = roundCurrency(priorDistributedByDebtor.get(b.id) ?? 0);
    const debtAmount = roundCurrency(Math.max(0, debtAmountRaw - alreadyDistributed));

    const baseCard = extractFamilyBaseCard(b.card_number);
    const allFamilyMembers = membersByBaseCard.get(baseCard) ?? [];
    const alreadyUsedMembers = priorDistributedMemberByDebtor.get(b.id) ?? new Set<string>();

    const familyMembers = allFamilyMembers
      .filter((m) => m.id !== b.id)
      .filter((m) => !alreadyUsedMembers.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        card_number: m.card_number,
        status: m.status as MemberStatus,
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
      debtorId: b.id,
      debtorName: b.name,
      debtorCard: b.card_number,
      familyBaseCard: baseCard,
      debtorTotalBalance: totalBalance,
      debtorSpent: spent,
      debtorDebtAmount: debtAmount,
      familyMembersCount: allFamilyMembers.length,
      familyAvailableTotal,
      plannedDistributed,
      residualDebtAfterDistribution,
      isSettled: debtAmount <= 0 || residualDebtAfterDistribution <= 0,
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

      if (c.shares.length === 0) continue;

      for (const share of c.shares) {
        const idempotencyKey = `${DEBT_SETTLE_IDEMPOTENCY_PREFIX}:${c.debtorId}:${share.memberId}`;

        await tx.transaction.upsert({
          where: { idempotency_key: idempotencyKey },
          update: {
            // في التشغيلات اللاحقة لا نعيد توزيع نفس الفرد؛ لكن upsert يحمي من السباقات.
            amount: share.deductedAmount,
            facility_id: effectiveFacilityId,
            is_cancelled: false,
          },
          create: {
            beneficiary_id: share.memberId,
            facility_id: effectiveFacilityId,
            amount: share.deductedAmount,
            idempotency_key: idempotencyKey,
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
