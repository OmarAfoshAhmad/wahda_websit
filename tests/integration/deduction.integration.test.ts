import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session-guard", () => ({
  requireActiveFacilitySession: vi.fn().mockResolvedValue({
    id: "integration-facility", name: "مرفق الاختبار", username: "integration_admin",
    is_admin: true, is_manager: false, is_employee: false,
  }),
  hasPermission: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/sse-notifications", () => ({ emitNotification: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { default: prisma } = await import("@/lib/prisma");
const { deductBalance } = await import("@/app/actions/deduction");
const { cancelTransaction } = await import("@/app/actions/cancel-transaction");
const { executeCashClaim } = await import("@/app/actions/cash-claim");
const { mergeDuplicateBeneficiaries } = await import("@/app/actions/beneficiary/merge");
const { encryptBackup } = await import("@/lib/backup-crypto");
const { createRestoreJob, processRestoreJob } = await import("@/lib/restore-jobs");

describe("deduction PostgreSQL integration", () => {
  beforeEach(async () => {
    await prisma.restoreJob.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.beneficiary.deleteMany();
    await prisma.facility.deleteMany();
    await prisma.facility.create({
      data: { id: "integration-facility", name: "مرفق الاختبار", username: "integration_admin", password_hash: "test", is_admin: true },
    });
    await prisma.beneficiary.create({
      data: { id: "integration-beneficiary", card_number: "WAB2025000001", name: "مستفيد اختبار", total_balance: 600, remaining_balance: 600 },
    });
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("prevents two concurrent deductions from overspending one balance", async () => {
    const [first, second] = await Promise.all([
      deductBalance({ beneficiary_id: "integration-beneficiary", card_number: "WAB2025000001", amount: 400, type: "MEDICINE", requestId: "concurrent-a" }),
      deductBalance({ beneficiary_id: "integration-beneficiary", card_number: "WAB2025000001", amount: 400, type: "MEDICINE", requestId: "concurrent-b" }),
    ]);
    expect([first, second].filter((result) => result.success)).toHaveLength(1);
    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({ where: { id: "integration-beneficiary" } });
    expect(Number(beneficiary.remaining_balance)).toBe(200);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it("makes a repeated request idempotent", async () => {
    const input = { beneficiary_id: "integration-beneficiary", card_number: "WAB2025000001", amount: 100, type: "MEDICINE" as const, requestId: "same-request" };
    expect((await deductBalance(input)).success).toBe(true);
    expect((await deductBalance(input)).success).toBe(true);
    expect(await prisma.transaction.count()).toBe(1);
    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({ where: { id: "integration-beneficiary" } });
    expect(Number(beneficiary.remaining_balance)).toBe(500);
  });

  it("cancels a deduction exactly once and restores its balance", async () => {
    await deductBalance({ beneficiary_id: "integration-beneficiary", card_number: "WAB2025000001", amount: 175, type: "MEDICINE", requestId: "cancel-source" });
    const original = await prisma.transaction.findFirstOrThrow({ where: { type: "MEDICINE" } });

    expect((await cancelTransaction(original.id)).success).toBe(true);
    expect(await cancelTransaction(original.id)).toMatchObject({ error: expect.any(String) });

    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({ where: { id: "integration-beneficiary" } });
    expect(Number(beneficiary.remaining_balance)).toBe(600);
    expect(await prisma.transaction.count({ where: { type: "CANCELLATION" } })).toBe(1);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: original.id } })).is_cancelled).toBe(true);
  });

  it("executes a family cash claim atomically and idempotently", async () => {
    await prisma.beneficiary.create({
      data: { id: "integration-family-member", card_number: "WAB2025000001S1", name: "فرد عائلة", total_balance: 600, remaining_balance: 600 },
    });
    const input = {
      allocations: [
        { beneficiary_id: "integration-beneficiary", amount: 120 },
        { beneficiary_id: "integration-family-member", amount: 80 },
      ],
      invoiceTotal: 200,
      requestId: "cash-claim-once",
    };

    expect((await executeCashClaim(input)).success).toContain("تم خصم");
    expect((await executeCashClaim(input)).success).toContain("منفذ مسبقاً");
    const rows = await prisma.beneficiary.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((row) => Number(row.remaining_balance))).toEqual([480, 520]);
    expect(await prisma.transaction.count()).toBe(2);
  });

  it("rolls back the entire cash claim when one member lacks balance", async () => {
    await prisma.beneficiary.create({
      data: { id: "integration-family-member", card_number: "WAB2025000001S1", name: "فرد عائلة", total_balance: 50, remaining_balance: 50 },
    });
    const result = await executeCashClaim({
      allocations: [
        { beneficiary_id: "integration-beneficiary", amount: 100 },
        { beneficiary_id: "integration-family-member", amount: 100 },
      ],
      invoiceTotal: 200,
      requestId: "cash-claim-invalid",
    });

    expect(result.error).toBeTruthy();
    expect(await prisma.transaction.count()).toBe(0);
    const balances = await prisma.beneficiary.findMany({ select: { remaining_balance: true } });
    expect(balances.map((row) => Number(row.remaining_balance)).sort()).toEqual([50, 600]);
  });

  it("merges zero-padded duplicate cards, moves movements, and preserves the calculated balance", async () => {
    await prisma.beneficiary.update({
      where: { id: "integration-beneficiary" },
      data: { card_number: "WAB20254552", remaining_balance: 500 },
    });
    await prisma.beneficiary.create({
      data: { id: "integration-legacy", card_number: "WAB20250004552", name: "مستفيد اختبار", total_balance: 600, remaining_balance: 400, is_legacy_card: true },
    });
    await prisma.transaction.createMany({ data: [
      { beneficiary_id: "integration-beneficiary", facility_id: "integration-facility", amount: 100, type: "MEDICINE" },
      { beneficiary_id: "integration-legacy", facility_id: "integration-facility", amount: 200, type: "SUPPLIES" },
    ] });

    const result = await mergeDuplicateBeneficiaries("integration-beneficiary", {
      forceKeep: true,
      candidateIds: ["integration-legacy"],
      explicitMergeIds: ["integration-legacy"],
    });

    expect(result).toMatchObject({ success: true, keepId: "integration-beneficiary", mergedCount: 1 });
    const kept = await prisma.beneficiary.findUniqueOrThrow({ where: { id: "integration-beneficiary" } });
    const legacy = await prisma.beneficiary.findUniqueOrThrow({ where: { id: "integration-legacy" } });
    expect(Number(kept.remaining_balance)).toBe(300);
    expect(legacy.deleted_at).not.toBeNull();
    expect(await prisma.transaction.count({ where: { beneficiary_id: "integration-beneficiary" } })).toBe(2);
    expect(await prisma.transaction.count({ where: { beneficiary_id: "integration-legacy" } })).toBe(0);
  });

  it("restores an encrypted snapshot and removes movements absent from it", async () => {
    const source = await prisma.transaction.create({
      data: { id: "restore-source", beneficiary_id: "integration-beneficiary", facility_id: "integration-facility", amount: 100, type: "MEDICINE" },
    });
    await prisma.beneficiary.update({ where: { id: "integration-beneficiary" }, data: { remaining_balance: 500 } });
    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: "integration-facility" } });
    const beneficiary = await prisma.beneficiary.findUniqueOrThrow({ where: { id: "integration-beneficiary" } });
    const backup = {
      version: "1.1",
      exported_at: new Date().toISOString(),
      includes_sensitive: true,
      manifest: { facilities: 1, beneficiaries: 1, transactions: 1, transaction_amount: 100, family_import_archive: 0, family_used_balance: 0 },
      data: {
        users: [{
          id: facility.id, name: facility.name, username: facility.username, password_hash: facility.password_hash,
          is_admin: facility.is_admin, is_manager: facility.is_manager, manager_permissions: facility.manager_permissions,
          must_change_password: facility.must_change_password, facility_type: facility.facility_type,
          deleted_at: null, created_at: facility.created_at.toISOString(),
        }],
        providers: [{
          id: beneficiary.id, card_number: beneficiary.card_number, name: beneficiary.name,
          total_balance: 600, remaining_balance: 500, status: "ACTIVE", is_legacy_card: false,
          failed_attempts: 0, created_at: beneficiary.created_at.toISOString(),
        }],
        transactions: [{
          id: source.id, beneficiary_id: beneficiary.id, facility_id: facility.id, amount: 100,
          type: "MEDICINE", is_cancelled: false, created_at: source.created_at.toISOString(),
        }],
        audit_logs: [], notifications: [], family_import_archive: [],
      },
    };
    await prisma.transaction.create({
      data: { id: "restore-extra", beneficiary_id: beneficiary.id, facility_id: facility.id, amount: 50, type: "SUPPLIES" },
    });
    await prisma.beneficiary.update({ where: { id: beneficiary.id }, data: { remaining_balance: 450 } });

    const created = await createRestoreJob({ username: "integration_admin", payload: encryptBackup(JSON.stringify(backup)) });
    expect(created.job).toBeTruthy();
    const processed = await processRestoreJob(created.job!.id, "integration_admin");

    expect(processed.job?.status).toBe("COMPLETED");
    expect(await prisma.transaction.count()).toBe(1);
    expect(await prisma.transaction.findUnique({ where: { id: "restore-extra" } })).toBeNull();
    expect(Number((await prisma.beneficiary.findUniqueOrThrow({ where: { id: beneficiary.id } })).remaining_balance)).toBe(500);
  });
});
