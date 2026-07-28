import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { applyOverdrawnDebtSettlement, getOverdrawnDebtCases } from "@/lib/overdrawn-debt-settlement";

describe("problem management company isolation", () => {
  const marker = `problem-scope-${Date.now()}`;
  const beneficiaryIds: string[] = [];
  let firstCompanyId: string;
  let secondCompanyId: string;
  let facilityId: string;
  const firstBaseCard = `WAB202597${Date.now()}1`;
  const secondBaseCard = `WAB202597${Date.now()}2`;

  beforeAll(async () => {
    expect(new URL(process.env.DATABASE_URL!).pathname.slice(1)).toMatch(/test|testing|snapshot/i);
    const firstCompany = await prisma.insuranceCompany.create({ data: { name: `${marker}-1`, code: `${marker}-1` } });
    const secondCompany = await prisma.insuranceCompany.create({ data: { name: `${marker}-2`, code: `${marker}-2` } });
    firstCompanyId = firstCompany.id;
    secondCompanyId = secondCompany.id;
    facilityId = (await prisma.facility.findFirstOrThrow({ where: { deleted_at: null }, select: { id: true } })).id;

    for (const [companyId, baseCard] of [[firstCompanyId, firstBaseCard], [secondCompanyId, secondBaseCard]] as const) {
      const beneficiary = await prisma.beneficiary.create({
        data: {
          company_id: companyId,
          card_number: baseCard,
          name: marker,
          total_balance: 100,
          remaining_balance: 100,
          status: "ACTIVE",
        },
      });
      beneficiaryIds.push(beneficiary.id);
      await prisma.familyImportArchive.create({
        data: {
          company_id: companyId,
          family_base_card: baseCard,
          family_count_from_file: 1,
          total_balance_from_file: 100,
          used_balance_from_file: 50,
          imported_by: marker,
          last_imported_at: new Date(),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { user: marker } });
    await prisma.transaction.deleteMany({ where: { beneficiary_id: { in: beneficiaryIds } } });
    await prisma.familyImportArchive.deleteMany({ where: { company_id: { in: [firstCompanyId, secondCompanyId] } } });
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    await prisma.insuranceCompany.deleteMany({ where: { id: { in: [firstCompanyId, secondCompanyId] } } });
    await prisma.$disconnect();
  });

  it("lists and settles only the selected company", async () => {
    const firstCases = await getOverdrawnDebtCases({ companyId: firstCompanyId });
    expect(firstCases).toHaveLength(1);
    expect(firstCases[0].companyId).toBe(firstCompanyId);
    expect((await getOverdrawnDebtCases({ companyId: secondCompanyId }))).toHaveLength(1);

    await applyOverdrawnDebtSettlement({
      user: marker,
      facilityId,
      companyId: firstCompanyId,
    });

    expect(await getOverdrawnDebtCases({ companyId: firstCompanyId })).toHaveLength(0);
    expect(await getOverdrawnDebtCases({ companyId: secondCompanyId })).toHaveLength(1);
    const secondCompanyTransactions = await prisma.transaction.count({
      where: { beneficiary_id: beneficiaryIds[1] },
    });
    expect(secondCompanyTransactions).toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { user: marker, action: "SETTLE_OVERDRAWN_FAMILY_DEBT" },
      select: { company_id: true },
    });
    expect(audit.company_id).toBe(firstCompanyId);
  });
});
