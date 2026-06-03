import prisma from "@/lib/prisma";
import { TransactionType } from "@prisma/client";
import { roundCurrency } from "@/lib/money";
import { INTERACTIVE_TX_OPTIONS } from "./constants";
import { BeneficiaryBalanceSnapshot, ImportAppliedRow } from "./types";
import { familySuffixRegex, buildFamilyBaseRegex } from "./utils";
import { findCompanyByCardNumber } from "@/lib/insurance/company-matcher";

export async function loadFamilyMembersSnapshot(baseCards: string[]): Promise<BeneficiaryBalanceSnapshot[]> {
  if (baseCards.length === 0) return [];
  const dedup = new Map<string, BeneficiaryBalanceSnapshot>();
  const familyRegex = buildFamilyBaseRegex(baseCards);

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    card_number: string;
    total_balance: number;
    remaining_balance: number;
    status: string;
    completed_via: string | null;
  }>>`
    SELECT
      b.id,
      b.name,
      b.card_number,
      b.total_balance::float8 AS total_balance,
      b.remaining_balance::float8 AS remaining_balance,
      b.status::text AS status,
      b.completed_via
    FROM "Beneficiary" b
    WHERE b.deleted_at IS NULL
      AND b.card_number ~ ${familyRegex}
    ORDER BY b.card_number ASC, b.id ASC
  `;

  for (const row of rows) {
    dedup.set(row.id, {
      beneficiaryId: row.id,
      beneficiaryName: row.name,
      cardNumber: row.card_number,
      totalBalance: Number(row.total_balance) || 0,
      remainingBalance: Number(row.remaining_balance) || 0,
      status: (String(row.status || "ACTIVE") as "ACTIVE" | "FINISHED" | "SUSPENDED"),
      completedVia: row.completed_via,
    });
  }

  return Array.from(dedup.values()).sort((a, b) => a.cardNumber.localeCompare(b.cardNumber));
}

export async function importFamilyTransactions(
  baseCard: string,
  totalUsedAmount: number,
  facilityId: string,
  expectedFamilyCount?: number,
  replaceOldImports = true,
  companyId?: string | null,
  personalOnly = false, // عندما يكون true يطبق الخصم فقط على صاحب البطاقة المحددة دون أفراد الأسرة
): Promise<{ count: number; mode: "created" | "updated"; appliedRows: ImportAppliedRow[] }> {
  let transactionCount = 0;
  const appliedRows: ImportAppliedRow[] = [];
  let hasExistingImport = false;

  await prisma.$transaction(async (tx) => {
    const allFamilyMembers = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; total_balance: number; status: string }>>`
      SELECT id, name, card_number, remaining_balance, total_balance, status
      FROM "Beneficiary"
      WHERE (
        card_number = ${baseCard}
        OR card_number ~ ${familySuffixRegex(baseCard)}
      )
        AND "deleted_at" IS NULL
      ORDER BY card_number ASC
      FOR UPDATE
    `;

    // الخصم الشخصي: نطبق فقط على صاحب البطاقة بالضبط دون أفراد الأسرة
    const familyMembers = personalOnly
      ? allFamilyMembers.filter((m) => m.card_number === baseCard)
      : allFamilyMembers;

    if (familyMembers.length === 0) {
      return;
    }

    const memberIds = familyMembers.map((m) => m.id);

    const existingImports = await tx.transaction.findMany({
      where: {
        beneficiary_id: { in: memberIds },
        type: TransactionType.IMPORT,
        is_cancelled: false,
      },
      select: { id: true, beneficiary_id: true, amount: true },
      orderBy: { created_at: "asc" },
    });
    hasExistingImport = existingImports.length > 0;

    const expectedCount = Math.max(0, Math.floor(Number(expectedFamilyCount) || 0));
    const divisor = Math.max(1, expectedCount > 0 ? expectedCount : familyMembers.length);
    const normalizedTotalUsed = Math.max(0, Math.round(totalUsedAmount));
    const baseShare = Math.floor(normalizedTotalUsed / divisor);
    const remainder = normalizedTotalUsed - baseShare * divisor;

    const importsByMember = new Map<string, Array<{ id: string; amount: number }>>();
    for (const imp of existingImports) {
      const arr = importsByMember.get(imp.beneficiary_id) ?? [];
      arr.push({ id: imp.id, amount: Number(imp.amount) });
      importsByMember.set(imp.beneficiary_id, arr);
    }

    const preCalcs = familyMembers.map((member) => {
      const currentBalance = Number(member.remaining_balance);
      const existingForMember = importsByMember.get(member.id) ?? [];
      const previousImported = existingForMember.reduce((sum, item) => sum + Number(item.amount), 0);
      const balanceBeforeImport = replaceOldImports
        ? roundCurrency(currentBalance + previousImported)
        : roundCurrency(currentBalance);
      return { member, existingForMember, balanceBeforeImport };
    });

    const remainderRecipientIndex = chooseRemainderRecipientIndex(
      preCalcs.map((c) => ({
        status: String(c.member.status ?? ""),
        availableBalance: c.balanceBeforeImport,
      })),
      remainder,
    );

    const calcs = [];

    for (let i = 0; i < familyMembers.length; i++) {
      const { member, existingForMember, balanceBeforeImport } = preCalcs[i];
      const plannedDeductAmount = i === remainderRecipientIndex ? baseShare + remainder : baseShare;
      const deductAmount = balanceBeforeImport > 0 && balanceBeforeImport >= plannedDeductAmount
        ? plannedDeductAmount
        : 0;
      const newBalance = roundCurrency(Math.max(0, balanceBeforeImport - deductAmount));

      calcs.push({ member, existingForMember, balanceBeforeImport, deductAmount, newBalance });
    }

    for (const c of calcs) {
      const { member, existingForMember, balanceBeforeImport, deductAmount, newBalance } = c;
      const newStatus = newBalance <= 0 ? "FINISHED" : "ACTIVE";

      appliedRows.push({
        beneficiaryId: member.id,
        beneficiaryName: member.name,
        cardNumber: member.card_number,
        familyBaseCard: baseCard,
        familySize: divisor,
        balanceBefore: balanceBeforeImport,
        deductedAmount: deductAmount,
        familyTotalDeduction: normalizedTotalUsed,
        balanceAfter: newBalance,
      });

      await tx.beneficiary.update({
        where: { id: member.id },
        data: {
          remaining_balance: newBalance,
          status: newStatus as "ACTIVE" | "FINISHED",
          completed_via: newStatus === "FINISHED" ? "IMPORT" : undefined,
        },
      });

      if (deductAmount <= 0) {
        if (existingForMember.length > 0) {
          await tx.transaction.deleteMany({
            where: { id: { in: existingForMember.map((item) => item.id) } },
          });
        }
        continue;
      }

      if (existingForMember.length === 0) {
        await tx.transaction.create({
          data: {
            beneficiary_id: member.id,
            facility_id: facilityId,
            amount: deductAmount,
            type: TransactionType.IMPORT,
            ...(companyId ? { company_id: companyId } : {}),
          },
        });
      } else {
        const newAmount = replaceOldImports
          ? deductAmount
          : roundCurrency(Number(existingForMember[0].amount || 0) + deductAmount);

        await tx.transaction.update({
          where: { id: existingForMember[0].id },
          data: {
            amount: newAmount,
            ...(companyId ? { company_id: companyId } : {}),
          },
        });

        if (existingForMember.length > 1) {
          await tx.transaction.deleteMany({
            where: { id: { in: existingForMember.slice(1).map((item) => item.id) } },
          });
        }
      }

      transactionCount++;
    }
  }, INTERACTIVE_TX_OPTIONS);

  return { count: transactionCount, mode: hasExistingImport ? "updated" : "created", appliedRows };
}

export async function suspendFamily(
  baseCard: string,
): Promise<"already_suspended" | { count: number }> {
  const familyMembers = await prisma.$queryRaw<Array<{ id: string; status: string; total_balance: number }>>`
    SELECT id, status::text, total_balance::float8
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND (
        card_number = ${baseCard}
        OR card_number ~ ${familySuffixRegex(baseCard)}
      )
    ORDER BY card_number ASC
  `;

  if (familyMembers.length === 0) return "already_suspended";

  const allZeroed = familyMembers.every((m) => Number(m.total_balance) === 0);
  if (allZeroed) return "already_suspended";

  await prisma.$transaction(
    familyMembers.map((member) =>
      prisma.beneficiary.update({
        where: { id: member.id },
        data: {
          total_balance: 0,
          remaining_balance: 0,
          status: "SUSPENDED" as const,
          completed_via: null,
        },
      }),
    ),
  );

  return { count: familyMembers.length };
}

export async function setFamilyBalance(
  baseCard: string,
  totalBalance: number,
  expectedFamilyCount?: number,
): Promise<"already_correct" | { count: number }> {
  return await prisma.$transaction(async (tx) => {
    const familyMembers = await tx.$queryRaw<Array<{ id: string; status: string; total_balance: number; remaining_balance: number }>>`
      SELECT id, status::text, total_balance::float8, remaining_balance::float8
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
        AND (
          card_number = ${baseCard}
          OR card_number ~ ${familySuffixRegex(baseCard)}
        )
      ORDER BY card_number ASC
      FOR UPDATE
    `;

    if (familyMembers.length === 0) return "already_correct";

    const expectedCount = Math.max(0, Math.floor(Number(expectedFamilyCount) || 0));
    const divisor = Math.max(1, expectedCount > 0 ? expectedCount : familyMembers.length);
    const normalizedTotalBalance = Math.max(0, Math.round(totalBalance));
    const baseShare = Math.floor(normalizedTotalBalance / divisor);
    const remainder = normalizedTotalBalance - baseShare * divisor;
    const remainderRecipientIndex = chooseRemainderRecipientIndex(
      familyMembers.map((m) => ({
        status: String(m.status ?? ""),
        availableBalance: Number(m.remaining_balance),
      })),
      remainder,
    );
    const memberIds = familyMembers.map((m) => m.id);

    await tx.transaction.deleteMany({
      where: {
        beneficiary_id: { in: memberIds },
        type: "IMPORT",
        is_cancelled: false,
      },
    });

    const manualDeductions = await tx.transaction.groupBy({
      by: ['beneficiary_id'],
      where: {
        beneficiary_id: { in: memberIds },
        type: { notIn: [TransactionType.IMPORT, TransactionType.CANCELLATION] },
        is_cancelled: false,
      },
      _sum: { amount: true },
    });

    const deductionMap = new Map<string, number>();
    for (const d of manualDeductions) {
      deductionMap.set(d.beneficiary_id, Number(d._sum.amount) || 0);
    }

    const alreadyCorrect = familyMembers.every((m, i) => {
      const expectedShare = i === remainderRecipientIndex ? baseShare + remainder : baseShare;
      const manualDed = deductionMap.get(m.id) || 0;
      const expectedRemaining = roundCurrency(Math.max(0, expectedShare - manualDed));
      const expectedStatus = expectedRemaining <= 0 ? "FINISHED" : "ACTIVE";
      return (
        m.status === expectedStatus &&
        Number(m.total_balance) === expectedShare &&
        Number(m.remaining_balance) === expectedRemaining
      );
    });
    if (alreadyCorrect) return "already_correct";

    for (let i = 0; i < familyMembers.length; i++) {
      const member = familyMembers[i];
      const share = i === remainderRecipientIndex ? baseShare + remainder : baseShare;
      const manualDed = deductionMap.get(member.id) || 0;
      const remaining = roundCurrency(Math.max(0, share - manualDed));
      const newStatus = remaining <= 0 ? "FINISHED" : "ACTIVE";
      await tx.beneficiary.update({
        where: { id: member.id },
        data: {
          total_balance: share,
          remaining_balance: remaining,
          status: newStatus as "ACTIVE" | "FINISHED",
          completed_via: newStatus === "FINISHED" ? "DEDUCTION" : null,
        },
      });
    }

    return { count: familyMembers.length };
  }, INTERACTIVE_TX_OPTIONS);
}

export function chooseRemainderRecipientIndex(
  recipients: Array<{ status: string; availableBalance: number }>,
  remainder: number,
): number {
  if (recipients.length === 0) return 0;
  if (remainder <= 0) return 0;

  let bestIndex = 0;
  let bestIsActive = false;
  let bestHasBalance = false;
  let bestBalance = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const isActive = recipient.status === "ACTIVE";
    const balance = Number(recipient.availableBalance ?? 0);
    const hasBalance = balance > 0;

    if (
      (isActive && hasBalance && !(bestIsActive && bestHasBalance)) ||
      (isActive === bestIsActive && hasBalance && !bestHasBalance) ||
      (isActive === bestIsActive && hasBalance === bestHasBalance && balance > bestBalance)
    ) {
      bestIsActive = isActive;
      bestHasBalance = hasBalance;
      bestBalance = balance;
      bestIndex = i;
    }
  }

  return bestIndex;
}
