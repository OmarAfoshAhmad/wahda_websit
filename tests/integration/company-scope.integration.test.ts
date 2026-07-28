import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildCompanyScope, getAllowedCompanyIds, ScopeAccessError } from "@/lib/company-scope";

const databaseUrl = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

describe("company scope against an isolated production snapshot", () => {
  let superAdminId: string;
  let managerId: string;
  let accountWithoutScopeId: string;
  let activeCompanyId: string;

  beforeAll(async () => {
    if (!databaseUrl || !/(^|[-_])(test|testing)([-_]|$)/i.test(new URL(databaseUrl).pathname)) {
      throw new Error("Refusing integration test: TEST_DATABASE_URL is not clearly a test database.");
    }
    const [superAdmin, manager, accountWithoutScope, activeCompany] = await Promise.all([
      prisma.facility.findFirstOrThrow({ where: { role_v2: "SUPER_ADMIN", deleted_at: null }, select: { id: true } }),
      prisma.facility.findFirstOrThrow({ where: { role_v2: "MANAGER", deleted_at: null }, select: { id: true } }),
      prisma.facility.findFirstOrThrow({
        where: { deleted_at: null, role_v2: { in: ["EMPLOYEE", "FACILITY"] }, company_accesses: { none: {} } },
        select: { id: true },
      }),
      prisma.insuranceCompany.findFirstOrThrow({ where: { deleted_at: null }, select: { id: true } }),
    ]);
    superAdminId = superAdmin.id;
    managerId = manager.id;
    accountWithoutScopeId = accountWithoutScope.id;
    activeCompanyId = activeCompany.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("gives SUPER_ADMIN every non-deleted company", async () => {
    const [allowed, expectedCount] = await Promise.all([
      getAllowedCompanyIds({ id: superAdminId }),
      prisma.insuranceCompany.count({ where: { deleted_at: null } }),
    ]);
    expect(allowed).toHaveLength(expectedCount);
    expect(allowed).toContain(activeCompanyId);
  });

  it("gives an initial manager every non-deleted company", async () => {
    const [allowed, expectedCount] = await Promise.all([
      getAllowedCompanyIds({ id: managerId }),
      prisma.insuranceCompany.count({ where: { deleted_at: null } }),
    ]);
    expect(allowed).toContain(activeCompanyId);
    expect(allowed).toHaveLength(expectedCount);
  });

  it("rejects a direct requested company for an account with no delegated scope", async () => {
    await expect(buildCompanyScope({ id: accountWithoutScopeId }, activeCompanyId)).rejects.toBeInstanceOf(ScopeAccessError);
  });
});
