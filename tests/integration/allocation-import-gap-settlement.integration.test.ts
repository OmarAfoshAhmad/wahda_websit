import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { applyOverdrawnDebtSettlement, getOverdrawnDebtCases } from "@/lib/overdrawn-debt-settlement";

describe("allocation import gap and problem-management settlement integration", () => {
  const familyBaseCard = `WAB202599${Date.now()}`;
  let companyId: string;
  let facilityId: string;
  const beneficiaryIds: string[] = [];

  beforeAll(async () => {
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(databaseName).toMatch(/test|testing|snapshot/i);
    const company = await prisma.insuranceCompany.findFirstOrThrow({ select: { id: true } });
    const facility = await prisma.facility.findFirstOrThrow({ where: { deleted_at: null }, select: { id: true } });
    companyId = company.id;
    facilityId = facility.id;

    for (const [suffix, name] of [["", "رئيس الأسرة"], ["M1", "فرد مضاف"]] as const) {
      const member = await prisma.beneficiary.create({
        data: {
          company_id: companyId,
          card_number: `${familyBaseCard}${suffix}`,
          name,
          total_balance: 100,
          remaining_balance: 100,
          status: "ACTIVE",
        },
      });
      beneficiaryIds.push(member.id);
    }
    await prisma.familyImportArchive.create({
      data: {
        company_id: companyId,
        family_base_card: familyBaseCard,
        family_count_from_file: 1,
        total_balance_from_file: 200,
        used_balance_from_file: 150,
        imported_by: "integration-test",
        last_imported_at: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({ where: { beneficiary_id: { in: beneficiaryIds } } });
    await prisma.familyImportArchive.deleteMany({ where: { company_id: companyId, family_base_card: familyBaseCard } });
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
  });

  it("uses every current member and closes the archive gap without a reverse debtor entry", async () => {
    const before = await getOverdrawnDebtCases({ companyId, familyBaseCard });
    expect(before).toHaveLength(1);
    expect(before[0].sourceType).toBe("IMPORT_GAP");
    expect(before[0].shares).toHaveLength(2);
    expect(before[0].plannedDistributed).toBe(150);

    const run = await applyOverdrawnDebtSettlement({
      user: "integration-test",
      facilityId,
      companyId,
      familyBaseCard,
    });
    expect(run.totalDebtBefore).toBe(150);
    expect(run.totalDistributed).toBe(150);
    expect(run.totalDebtAfter).toBe(0);

    const settlements = await prisma.transaction.findMany({
      where: { beneficiary_id: { in: beneficiaryIds }, type: "SETTLEMENT", is_cancelled: false },
      select: { amount: true, company_id: true, idempotency_key: true },
    });
    expect(settlements).toHaveLength(2);
    expect(settlements.every((tx) => Number(tx.amount) > 0)).toBe(true);
    expect(settlements.every((tx) => tx.company_id === companyId)).toBe(true);
    expect(settlements.reduce((sum, tx) => sum + Number(tx.amount), 0)).toBe(150);
    expect(await getOverdrawnDebtCases({ companyId, familyBaseCard })).toHaveLength(0);
  }, 120_000);
});
