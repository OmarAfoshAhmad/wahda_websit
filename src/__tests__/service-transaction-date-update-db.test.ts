import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { updateImportedServiceTransactionDates } from "@/lib/service-transaction-date-update";

vi.mock("@/lib/prisma", () => ({
  default: {
    transaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback) => callback({
      transaction: { updateMany: prisma.transaction.updateMany },
      auditLog: { create: prisma.auditLog.create },
    })),
  },
}));

const row = {
  rowNumber: 4,
  name: "مستفيد تجريبي",
  card: "WAB2025001",
  approval: "WAB004",
  amount: 745,
  date: new Date("2026-04-07T00:00:00.000Z"),
  facilityName: "مركز تجريبي",
};

const oldTransaction = {
  id: "tx-1",
  amount: 745,
  created_at: new Date("2026-07-04T00:00:00.000Z"),
  idempotency_key: "import-physiotherapy-tx:4:WAB2025001:745:2026-07-04",
  beneficiary: { card_number: "WAB2025001", name: "مستفيد تجريبي" },
};

function options(dryRun: boolean) {
  return {
    rows: [row],
    transactionType: "PHYSIOTHERAPY" as const,
    keyPrefix: "import-physiotherapy-tx",
    companyId: "company-1",
    actorId: "admin-1",
    actorUsername: "admin",
    sourceFileName: "WAB_Transactions_PT.xlsx",
    dryRun,
  };
}

describe("updateImportedServiceTransactionDates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews one safe date update without writing", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([oldTransaction] as never);

    const result = await updateImportedServiceTransactionDates(options(true));

    expect(result.updatedCount).toBe(1);
    expect(result.missingCount).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reports a missing original movement", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await updateImportedServiceTransactionDates(options(true));

    expect(result.updatedCount).toBe(0);
    expect(result.missingCount).toBe(1);
    expect(result.issues[0].reason).toContain("لم توجد حركة");
  });

  it("blocks a row that has no card instead of silently ignoring it", async () => {
    const result = await updateImportedServiceTransactionDates({
      ...options(true),
      rows: [{ ...row, card: "" }],
    });

    expect(result.updatedCount).toBe(0);
    expect(result.missingCount).toBe(1);
    expect(result.issues[0].reason).toContain("رقم البطاقة فارغ");
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("updates only created_at and idempotency_key and writes an audit log", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([oldTransaction] as never);
    vi.mocked(prisma.transaction.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as never);

    const result = await updateImportedServiceTransactionDates(options(false));

    expect(result.updatedCount).toBe(1);
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        created_at: new Date("2026-04-07T00:00:00.000Z"),
        idempotency_key: "import-physiotherapy-tx:4:WAB2025001:745:2026-04-07",
      },
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "UPDATE_IMPORTED_SERVICE_TRANSACTION_DATES" }),
    }));
  });
});
