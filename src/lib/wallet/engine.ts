import prisma from "@/lib/prisma";
import { roundCurrency } from "@/lib/money";
import { logger } from "@/lib/logger";
import type {
  DeductClaimInput,
  ClaimResult,
  WalletState,
  PolicyLimitRow,
} from "./types";

const SERVICE_TYPES_WITH_MAPPINGS = ["MEDICINE", "SUPPLIES"] as const;

// ─── 1. Wallet Resolution ──────────────────────────────────────────────────

export async function resolveWallet(
  companyId: string | null,
  serviceType: string,
): Promise<string> {
  if (!companyId) return serviceType;
  if (!SERVICE_TYPES_WITH_MAPPINGS.includes(serviceType as any)) {
    if (serviceType.startsWith("DENTAL")) {
      return "DENTAL";
    }
    return serviceType;
  }
  const mapping = await prisma.serviceTypeMapping.findUnique({
    where: {
      company_id_service_type: {
        company_id: companyId,
        service_type: serviceType,
      },
    },
  });
  return mapping?.mapped_to ?? serviceType;
}

// ─── 2. Policy Limit Fetch ─────────────────────────────────────────────────

export async function fetchPolicyLimit(
  companyId: string,
  walletType: string,
): Promise<PolicyLimitRow | null> {
  const company = await prisma.insuranceCompany.findUnique({
    where: { id: companyId },
    include: { service_policies: { include: { service_type: true } } }
  });
  if (!company || !company.is_active || company.deleted_at !== null) return null;

  let annual_ceiling: number | null = null;
  let copay_percentage = 0;

  if (walletType === "DENTAL") {
    const dentalPolicy = (company as any).service_policies?.find((p: any) => p.service_type?.code === "DENTAL");
    annual_ceiling = dentalPolicy && dentalPolicy.ceiling_amount !== null ? Number(dentalPolicy.ceiling_amount) : null;
    copay_percentage = Math.max(0, 100 - (dentalPolicy ? Number(dentalPolicy.coverage_percent) : 100));
  } else if (walletType === "GENERAL") {
    annual_ceiling = company.general_ceiling === null ? null : Number(company.general_ceiling);
    copay_percentage = Math.max(0, 100 - Number(company.general_coverage));
  } else if (walletType === "MEDICINE") {
    annual_ceiling = company.medicine_ceiling === null ? null : Number(company.medicine_ceiling);
    copay_percentage = Math.max(0, 100 - Number(company.medicine_coverage));
  } else {
    return null;
  }

  return {
    annual_ceiling,
    copay_percentage,
    allow_partial_coverage: true,
  };
}

// ─── 3. Consumption Read (with SELECT FOR UPDATE) ─────────────────────────

async function lockAndReadConsumption(
  beneficiaryId: string,
  companyId: string,
  walletType: string,
  fiscalYear: number,
): Promise<{ consumed_amount: number; version: number }> {
  const result = await prisma.$queryRawUnsafe<Array<{ consumed_amount: string; version: number }>>(
    `SELECT consumed_amount::text, version
     FROM "WalletConsumption"
     WHERE beneficiary_id = $1 AND company_id = $2 AND wallet_type = $3 AND fiscal_year = $4
     FOR UPDATE`,
    beneficiaryId,
    companyId,
    walletType,
    fiscalYear,
  );
  if (result.length === 0) {
    return { consumed_amount: 0, version: 0 };
  }
  return {
    consumed_amount: Number(result[0].consumed_amount),
    version: result[0].version,
  };
}

// ─── 4. Consumption Upsert (optimistic locking via raw SQL) ────────────────

async function upsertConsumption(
  beneficiaryId: string,
  companyId: string,
  walletType: string,
  fiscalYear: number,
  additional: number,
  expectedVersion: number,
): Promise<number> {
  const newConsumed = roundCurrency(additional);
  if (newConsumed === 0) return 0;

  if (expectedVersion === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WalletConsumption" (id, beneficiary_id, company_id, wallet_type, fiscal_year, consumed_amount, version, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (beneficiary_id, company_id, wallet_type, fiscal_year)
       DO UPDATE SET consumed_amount = "WalletConsumption".consumed_amount + $5, version = "WalletConsumption".version + 1, updated_at = NOW()`,
      beneficiaryId,
      companyId,
      walletType,
      fiscalYear,
      newConsumed,
    );
  } else {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "WalletConsumption"
       SET consumed_amount = consumed_amount + $5, version = version + 1, updated_at = NOW()
       WHERE beneficiary_id = $1 AND company_id = $2 AND wallet_type = $3 AND fiscal_year = $4
         AND version = $6`,
      beneficiaryId,
      companyId,
      walletType,
      fiscalYear,
      newConsumed,
      expectedVersion,
    );
    if (result === 0) {
      throw new Error("CONCURRENCY_CONFLICT|WalletConsumption|" + walletType);
    }
  }
  const updated = await prisma.$queryRawUnsafe<Array<{ consumed_amount: string }>>(
    `SELECT consumed_amount::text FROM "WalletConsumption"
     WHERE beneficiary_id = $1 AND company_id = $2 AND wallet_type = $3 AND fiscal_year = $4`,
    beneficiaryId,
    companyId,
    walletType,
    fiscalYear,
  );
  return Number(updated[0]?.consumed_amount ?? 0);
}

// ─── 5. Core Deduction Logic ──────────────────────────────────────────────

export async function processClaim(input: DeductClaimInput): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    const { beneficiaryId, companyId, serviceType, amount, fiscalYear } = input;

    // 1. Resolve wallet
    const walletType = await resolveWallet(companyId, serviceType);

    if (!companyId) {
      // Legacy (non-TPA): skip wallet ceiling check
      return {
        claimId: "",
        status: "APPROVED",
        walletType,
        requestedAmount: amount,
        approvedAmount: amount,
        limitAnnual: null,
        consumedBefore: 0,
        consumedAfter: 0,
        remainingBefore: Infinity,
        remainingAfter: Infinity,
      };
    }

    // 2. Fetch policy limit
    const policyLimit = await fetchPolicyLimit(companyId, walletType);
    if (!policyLimit) {
      throw new Error(`No policy limit configured for ${walletType}`);
    }

    // 3. Lock & read current consumption (SELECT FOR UPDATE)
    const current = await lockAndReadConsumption(beneficiaryId, companyId, walletType, fiscalYear);

    const limitAnnual = policyLimit.annual_ceiling;
    const consumedBefore = current.consumed_amount;
    const openCeiling = limitAnnual === null;

    const remainingBefore = openCeiling ? Infinity : Math.max(0, limitAnnual! - consumedBefore);

    // 4. Decision
    let approvedAmount: number;
    let status: "APPROVED" | "PARTIAL" | "REJECTED";

    if (openCeiling) {
      approvedAmount = amount;
      status = "APPROVED";
    } else if (remainingBefore <= 0) {
      approvedAmount = 0;
      status = "REJECTED";
    } else if (amount <= remainingBefore) {
      approvedAmount = amount;
      status = "APPROVED";
    } else if (policyLimit.allow_partial_coverage) {
      approvedAmount = remainingBefore;
      status = "PARTIAL";
    } else {
      approvedAmount = 0;
      status = "REJECTED";
    }

    // 5. Deduct consumption (only if approved/partial)
    let consumedAfter = consumedBefore;
    if (status !== "REJECTED") {
      consumedAfter = await upsertConsumption(
        beneficiaryId,
        companyId,
        walletType,
        fiscalYear,
        approvedAmount,
        current.version,
      );
    }

    // 6. Remaining after
    const remainingAfter = openCeiling
      ? Infinity
      : Math.max(0, limitAnnual! - consumedAfter);

    // 7. Create audit log entry
    await tx.claimAuditLog.create({
      data: {
        claim_id: "",
        action: status === "REJECTED" ? "REJECTED" : status === "PARTIAL" ? "PARTIAL" : "APPROVED",
        wallet_type: walletType,
        limit_annual: limitAnnual,
        consumed_before: consumedBefore,
        consumed_after: consumedAfter,
        requested: amount,
        approved: approvedAmount,
        remaining: remainingAfter === Infinity ? null : remainingAfter,
      },
    });

    return {
      claimId: "",
      status,
      walletType,
      requestedAmount: amount,
      approvedAmount,
      limitAnnual,
      consumedBefore,
      consumedAfter,
      remainingBefore: remainingBefore === Infinity ? Infinity : remainingBefore,
      remainingAfter: remainingAfter === Infinity ? Infinity : remainingAfter,
    };
  });
}

// ─── 6. Batch / Idempotency ────────────────────────────────────────────────

export async function processClaimIdempotent(
  input: DeductClaimInput,
): Promise<ClaimResult> {
  const key = input.requestId
    ? `claim:${input.beneficiaryId}:${input.requestId}`
    : null;

  if (key) {
    const existing = await prisma.claim.findUnique({
      where: { idempotency_key: key },
    });
    if (existing) {
      return {
        claimId: existing.id,
        status: existing.status as ClaimResult["status"],
        walletType: existing.wallet_type,
        requestedAmount: Number(existing.requested_amount),
        approvedAmount: Number(existing.approved_amount),
        limitAnnual: null,
        consumedBefore: 0,
        consumedAfter: 0,
        remainingBefore: 0,
        remainingAfter: 0,
      };
    }
  }

  const result = await processClaim(input);
  return result;
}

// ─── 7. Migration helper: migrate JSON mappings to table ──────────────────

export async function migrateMappingsToTable() {
  const companies = await prisma.$queryRawUnsafe<Array<{ id: string; service_type_mappings: string | null }>>(
    `SELECT id, "service_type_mappings"::text AS service_type_mappings
     FROM "InsuranceCompany"
     WHERE "service_type_mappings" IS NOT NULL AND deleted_at IS NULL`
  );

  for (const company of companies) {
    const mappingsRaw = company.service_type_mappings;
    if (!mappingsRaw) continue;
    const mappings = (typeof mappingsRaw === "string" ? JSON.parse(mappingsRaw) : mappingsRaw) as Record<string, string>;
    if (!mappings) continue;

    for (const [serviceType, mappedTo] of Object.entries(mappings)) {
      await prisma.serviceTypeMapping.upsert({
        where: {
          company_id_service_type: {
            company_id: company.id,
            service_type: serviceType,
          },
        },
        update: { mapped_to: mappedTo },
        create: {
          company_id: company.id,
          service_type: serviceType,
          mapped_to: mappedTo,
        },
      });
    }
  }

  logger.info("MIGRATE_MAPPINGS_DONE", { count: companies.length });
}

// ─── 8. Initialize consumption from existing transactions ──────────────────

export async function seedConsumptionFromTransactions(
  beneficiaryId: string,
  companyId: string,
  fiscalYear: number,
) {
  const txns = await prisma.transaction.findMany({
    where: {
      beneficiary_id: beneficiaryId,
      company_id: companyId,
      is_cancelled: false,
      type: { not: "CANCELLATION" },
      created_at: {
        gte: new Date(fiscalYear, 0, 1),
        lte: new Date(fiscalYear, 11, 31, 23, 59, 59),
      },
    },
    select: { service_category: true, ceiling_consumed: true },
  });

  const grouped: Record<string, number> = {};
  for (const t of txns) {
    let wallet = t.service_category ?? "GENERAL";
    if (wallet.startsWith("DENTAL")) {
      wallet = "DENTAL";
    }
    grouped[wallet] = (grouped[wallet] ?? 0) + Number(t.ceiling_consumed ?? 0);
  }

  for (const [walletType, total] of Object.entries(grouped)) {
    if (total <= 0) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WalletConsumption" (id, beneficiary_id, company_id, wallet_type, fiscal_year, consumed_amount, version, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (beneficiary_id, company_id, wallet_type, fiscal_year)
       DO UPDATE SET consumed_amount = GREATEST("WalletConsumption".consumed_amount, $5), updated_at = NOW()`,
      beneficiaryId,
      companyId,
      walletType,
      fiscalYear,
      roundCurrency(total),
    );
  }
}
