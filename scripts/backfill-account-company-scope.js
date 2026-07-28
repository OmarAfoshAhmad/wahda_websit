"use strict";

function requireConfiguration(assertTestDatabase) {
  const allowLocalDevelopment = process.argv.includes("--allow-local-development");
  const databaseUrl = allowLocalDevelopment
    ? process.env.DEVELOPMENT_DATABASE_URL
    : process.env.TEST_DATABASE_URL;
  const superAdminAccountId = process.env.SUPER_ADMIN_ACCOUNT_ID;
  if (allowLocalDevelopment) {
    if (!databaseUrl) throw new Error("DEVELOPMENT_DATABASE_URL is required.");
    const parsed = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
    if (!localHost || databaseName !== "wahda_db") {
      throw new Error("Refusing development backfill: only local database 'wahda_db' is allowed.");
    }
  } else {
    assertTestDatabase(databaseUrl);
  }
  if (!superAdminAccountId) throw new Error("SUPER_ADMIN_ACCOUNT_ID is required.");
  return { databaseUrl, superAdminAccountId, apply: process.argv.includes("--apply") };
}

function resolveBackfillRole(row, superAdminAccountId, proposedRole) {
  if (row.id === superAdminAccountId) return "SUPER_ADMIN";
  if (row.is_admin || ["ADMIN", "SUPER_ADMIN"].includes(String(row.role ?? "").toUpperCase())) {
    return "MANAGER";
  }
  if (row.is_manager && String(row.role ?? "").toUpperCase() === "FACILITY") {
    return "MANAGER";
  }
  const proposal = proposedRole(row, superAdminAccountId);
  return proposal.status === "safe" ? proposal.role : null;
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { assertTestDatabase } = await import("./assert-test-database.js");
  const { proposedRole } = await import("./audit-account-company-backfill.js");
  const config = requireConfiguration(assertTestDatabase);
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl, log: ["error"] });
  try {
    const [accounts, companies] = await Promise.all([
      prisma.facility.findMany({
        where: { deleted_at: null },
        select: { id: true, username: true, role: true, role_v2: true, is_admin: true, is_manager: true, is_employee: true },
      }),
      prisma.insuranceCompany.findMany({ where: { deleted_at: null }, select: { id: true } }),
    ]);
    const superAdmin = accounts.find((row) => row.id === config.superAdminAccountId);
    if (!superAdmin || superAdmin.username !== "admin") {
      throw new Error("Configured SUPER_ADMIN_ACCOUNT_ID does not identify the confirmed active 'admin' account.");
    }

    const mappings = accounts.map((account) => ({ account, role: resolveBackfillRole(account, config.superAdminAccountId, proposedRole) }));
    const unresolved = mappings.filter((row) => !row.role);
    if (unresolved.length) {
      throw new Error(`Refusing backfill: ${unresolved.length} active account role mappings are unresolved.`);
    }
    const managers = mappings.filter((row) => row.role === "MANAGER");
    const companyAccessRows = managers.flatMap(({ account }) =>
      companies.map((company) => ({
        account_id: account.id,
        company_id: company.id,
        created_by_id: config.superAdminAccountId,
      })),
    );
    const preview = {
      mode: config.apply ? "apply" : "preview",
      superAdmin: { id: superAdmin.id, username: superAdmin.username },
      activeAccounts: accounts.length,
      roleUpdates: mappings.filter(({ account, role }) => account.role_v2 !== role).length,
      managers: managers.length,
      companies: companies.length,
      managerCompanyAccessRows: companyAccessRows.length,
    };
    if (!config.apply) {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      let roleUpdates = 0;
      for (const { account, role } of mappings) {
        if (account.role_v2 === role) continue;
        await tx.facility.update({ where: { id: account.id }, data: { role_v2: role } });
        roleUpdates += 1;
      }
      const access = await tx.accountCompanyAccess.createMany({ data: companyAccessRows, skipDuplicates: true });
      await tx.auditLog.create({
        data: {
          facility_id: config.superAdminAccountId,
          user: superAdmin.username,
          action: "BACKFILL_ACCOUNT_COMPANY_SCOPE",
          metadata: {
            role_updates: roleUpdates,
            manager_company_access_created: access.count,
            managers: managers.length,
            companies: companies.length,
            source: "confirmed_production_snapshot_backfill",
          },
        },
      });
      return { ...preview, roleUpdatesApplied: roleUpdates, managerCompanyAccessCreated: access.count };
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Company scope backfill failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { resolveBackfillRole };
