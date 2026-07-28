import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";

const sessionState = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("@/lib/session-guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/session-guard")>();
  return { ...original, requireActiveFacilitySession: vi.fn(async () => sessionState.session) };
});

describe("beneficiary bulk action company scope", () => {
  const ids: string[] = [];

  beforeAll(async () => {
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(databaseName).toMatch(/test|testing|snapshot/i);
    const companies = await prisma.insuranceCompany.findMany({ take: 2, orderBy: { id: "asc" }, select: { id: true } });
    if (companies.length < 2) throw new Error("Two companies are required");
    const admin = await prisma.facility.findFirstOrThrow({
      where: { role_v2: "SUPER_ADMIN", deleted_at: null },
      select: { id: true, username: true, name: true },
    });
    sessionState.session = {
      ...admin, role: "SUPER_ADMIN", role_v2: "SUPER_ADMIN", is_admin: true,
      is_manager: false, is_employee: false, manager_permissions: null, must_change_password: false,
    };
    for (const [index, company] of companies.entries()) {
      const row = await prisma.beneficiary.create({
        data: {
          company_id: company.id,
          card_number: `BULK_SCOPE_${Date.now()}_${index}`,
          name: `اختبار جماعي ${index + 1}`,
          total_balance: 100,
          remaining_balance: 100,
        },
      });
      ids.push(row.id);
    }
  });

  afterAll(async () => {
    await prisma.beneficiary.deleteMany({ where: { id: { in: ids } } });
  });

  it("rejects a mixed-company bulk delete before changing either row", async () => {
    const { bulkDeleteBeneficiaries } = await import("@/app/actions/beneficiary/bulk");
    const formData = new FormData();
    ids.forEach((id) => formData.append("ids", id));
    expect(await bulkDeleteBeneficiaries(formData)).toEqual({
      error: "يجب أن تنتمي كل السجلات المحددة إلى شركة واحدة",
    });
    const rows = await prisma.beneficiary.findMany({ where: { id: { in: ids } }, select: { deleted_at: true } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.deleted_at === null)).toBe(true);
  });
});
