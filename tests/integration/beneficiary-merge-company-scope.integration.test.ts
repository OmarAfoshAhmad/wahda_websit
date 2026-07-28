import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";

const sessionState = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("@/lib/session-guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/session-guard")>();
  return {
    ...original,
    requireActiveFacilitySession: vi.fn(async () => sessionState.session),
  };
});

describe("beneficiary merge company scope", () => {
  const beneficiaryIds: string[] = [];
  let firstId: string;
  let secondId: string;

  beforeAll(async () => {
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(databaseName).toMatch(/test|testing|snapshot/i);
    const companies = await prisma.insuranceCompany.findMany({ take: 2, orderBy: { id: "asc" }, select: { id: true } });
    if (companies.length < 2) throw new Error("Two companies are required");
    const admin = await prisma.facility.findFirstOrThrow({
      where: { role_v2: "SUPER_ADMIN", deleted_at: null },
      select: { id: true, username: true, name: true, role_v2: true },
    });
    sessionState.session = {
      ...admin,
      is_admin: true,
      is_manager: false,
      is_employee: false,
      role: "SUPER_ADMIN",
      manager_permissions: null,
      must_change_password: false,
    };

    const digits = `${Date.now()}`.slice(-9);
    const first = await prisma.beneficiary.create({
      data: {
        company_id: companies[0].id,
        card_number: `WAB2025${digits}`,
        name: "اختبار شركة أولى",
        total_balance: 100,
        remaining_balance: 100,
      },
    });
    const second = await prisma.beneficiary.create({
      data: {
        company_id: companies[1].id,
        card_number: `WAB20250${digits}`,
        name: "اختبار شركة ثانية",
        total_balance: 100,
        remaining_balance: 100,
      },
    });
    firstId = first.id;
    secondId = second.id;
    beneficiaryIds.push(first.id, second.id);
  });

  afterAll(async () => {
    await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
  });

  it("rejects an explicit merge across two companies", async () => {
    const { mergeDuplicateBeneficiaries } = await import("@/app/actions/beneficiary/merge");
    const result = await mergeDuplicateBeneficiaries(firstId, {
      forceKeep: true,
      explicitMergeIds: [secondId],
      candidateIds: [firstId, secondId],
    });
    expect(result).toEqual({ error: "لا يمكن دمج مستفيدين تابعين لشركات مختلفة" });
    const rows = await prisma.beneficiary.findMany({ where: { id: { in: beneficiaryIds } }, select: { deleted_at: true } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.deleted_at === null)).toBe(true);
  });
});
