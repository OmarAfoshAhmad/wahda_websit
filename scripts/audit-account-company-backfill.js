"use strict";

function requireAuditUrl() {
  const value = process.env.AUDIT_DATABASE_URL;
  if (!value) {
    throw new Error("AUDIT_DATABASE_URL is required; DATABASE_URL is intentionally ignored.");
  }
  const parsed = new URL(value);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("AUDIT_DATABASE_URL must be a PostgreSQL URL.");
  }
  return value;
}

function proposedRole(row, superAdminAccountId = process.env.SUPER_ADMIN_ACCOUNT_ID) {
  const allowed = new Set(["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "EMPLOYEE", "FACILITY"]);
  if (row.role_v2 && allowed.has(row.role_v2)) {
    return { status: "safe", role: row.role_v2, reason: "existing_role_v2" };
  }
  if (superAdminAccountId && row.id === superAdminAccountId) {
    return { status: "safe", role: "SUPER_ADMIN", reason: "explicit_account_id" };
  }
  const signals = [
    row.is_admin && "LEGACY_ADMIN_REQUIRES_DECISION",
    row.is_manager && "MANAGER",
    row.is_employee && "EMPLOYEE",
    typeof row.role === "string" && row.role.trim() && row.role.trim().toUpperCase(),
  ].filter(Boolean);
  const normalized = [...new Set(signals.map((value) => value === "ADMIN" ? "LEGACY_ADMIN_REQUIRES_DECISION" : value))];
  if (normalized.length === 0) return { status: "safe", role: "FACILITY" };
  if (normalized.length === 1 && allowed.has(normalized[0])) {
    return { status: "safe", role: normalized[0] };
  }
  if (normalized.some((value) => !allowed.has(value))) {
    return { status: "unresolved", signals: normalized };
  }
  return { status: "ambiguous", signals: normalized };
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: requireAuditUrl(), log: ["error"] });
  try {
    const report = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [facilities, companies, serviceTypes, nulls, mismatches] = await Promise.all([
        tx.facility.findMany({
          select: { id: true, role: true, role_v2: true, is_admin: true, is_manager: true, is_employee: true, facility_type: true, manager_permissions: true },
        }),
        tx.insuranceCompany.count({ where: { deleted_at: null } }),
        tx.serviceType.findMany({ select: { id: true, code: true } }),
        Promise.all([
          tx.beneficiary.count({ where: { company_id: null } }),
          tx.transaction.count({ where: { company_id: null } }),
          tx.claim.count({ where: { company_id: null } }),
        ]),
        Promise.all([
          tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "Transaction" t JOIN "Beneficiary" b ON b.id=t.beneficiary_id WHERE t.company_id IS NOT NULL AND b.company_id IS NOT NULL AND t.company_id <> b.company_id`,
          tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "Claim" c JOIN "Beneficiary" b ON b.id=c.beneficiary_id WHERE c.company_id IS NOT NULL AND b.company_id IS NOT NULL AND c.company_id <> b.company_id`,
          tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "Transaction" t JOIN "Beneficiary" b ON b.id=t.beneficiary_id WHERE t.company_id IS NULL AND b.company_id IS NOT NULL`,
        ]),
      ]);

      const roles = facilities.map((row) => ({ id: row.id, ...proposedRole(row) }));
      const managers = roles.filter((row) => row.role === "MANAGER" && row.status === "safe");
      const serviceCodes = new Set(serviceTypes.map((row) => row.code.toUpperCase()));
      const directFacilityCapabilitySuggestions = facilities.filter((row) =>
        ["DENTAL", "OPTICS", "PHYSIOTHERAPY"].includes(String(row.facility_type ?? "").toUpperCase())
        && serviceCodes.has(String(row.facility_type).toUpperCase())
      ).length;
      const multiServiceFacilitiesRequiringReview = facilities.filter((row) =>
        ["HOSPITAL", "AUTO", ""].includes(String(row.facility_type ?? "").toUpperCase())
      ).length;
      return {
        mode: "read-only dry-run",
        counts: {
          companies,
          accounts: facilities.length,
          safeRoleMappings: roles.filter((row) => row.status === "safe").length,
          ambiguousRoleMappings: roles.filter((row) => row.status === "ambiguous").length,
          unresolvedRoleMappings: roles.filter((row) => row.status === "unresolved").length,
          initialManagerCompanyAccessProposals: managers.length * companies,
          directFacilityCapabilitySuggestions,
          multiServiceFacilitiesRequiringReview,
          beneficiariesWithoutCompany: nulls[0],
          transactionsWithoutCompany: nulls[1],
          claimsWithoutCompany: nulls[2],
          transactionBeneficiaryCompanyMismatches: mismatches[0][0]?.count ?? 0,
          claimBeneficiaryCompanyMismatches: mismatches[1][0]?.count ?? 0,
          transactionsWithoutCompanyWhoseBeneficiaryHasCompany: mismatches[2][0]?.count ?? 0,
        },
        ambiguousRoles: roles.filter((row) => row.status === "ambiguous").slice(0, 100),
        unresolvedRoles: roles.filter((row) => row.status === "unresolved").slice(0, 100),
        policy: {
          superAdmin: "Only SUPER_ADMIN_ACCOUNT_ID may be proposed as SUPER_ADMIN.",
          managers: "Every safely identified existing manager is proposed access to every company initially.",
          services: "Company scope and service scope remain independent; hospital/AUTO facilities are never assigned a service from facility_type alone.",
        },
        note: "No writes are performed. Audit/job company assignment remains unproposed without unambiguous evidence.",
      };
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Backfill audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { proposedRole, requireAuditUrl };
