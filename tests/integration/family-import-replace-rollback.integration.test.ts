import { beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { processTransactionImport } from "@/lib/import-transactions/core";

const sessionState = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("@/lib/session-guard", () => ({
  requireActiveFacilitySession: vi.fn(async () => sessionState.session),
}));

describe("replace-old-imports and rollback", () => {
  let username: string;
  let facilityId: string;

  beforeAll(async () => {
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(databaseName).toMatch(/test|testing|snapshot/i);
    const facility = await prisma.facility.findFirstOrThrow({
      where: { role_v2: "SUPER_ADMIN", deleted_at: null },
      select: { id: true, username: true },
    });
    username = facility.username;
    facilityId = facility.id;
    sessionState.session = { id: facility.id, username: facility.username, role_v2: "SUPER_ADMIN" };
  });

  it("restores every old IMPORT and every affected beneficiary", async () => {
    const candidateRows = await prisma.beneficiary.findMany({
      where: {
        deleted_at: null,
        company_id: { not: null },
        card_number: { startsWith: "WAB2025" },
        total_balance: { gte: 10 },
        transactions: { none: { type: "IMPORT" } },
      },
      select: { id: true, card_number: true, company_id: true, total_balance: true },
      orderBy: { card_number: "asc" }, take: 500,
    });
    const candidate = candidateRows.find((row) => /^WAB2025\d+$/.test(row.card_number));
    if (!candidate || !/^WAB2025\d+$/.test(candidate.card_number) || !candidate.company_id) {
      throw new Error("No safe base-card candidate found");
    }
    const fixtureHeads = candidateRows.filter((row) => /^WAB2025\d+$/.test(row.card_number) && row.company_id).slice(0, 2);
    if (fixtureHeads.length < 2) throw new Error("Two base-card families are required");
    await prisma.transaction.createMany({
      data: fixtureHeads.map((head, index) => ({
        beneficiary_id: head.id,
        facility_id: facilityId,
        company_id: head.company_id,
        amount: index + 2,
        type: "IMPORT" as const,
      })),
    });

    const familyMembers = await prisma.beneficiary.findMany({
      where: { company_id: candidate.company_id, deleted_at: null, card_number: { startsWith: candidate.card_number } },
      select: { id: true },
    });
    const familyTotal = await prisma.beneficiary.aggregate({
      where: { id: { in: familyMembers.map((member) => member.id) } },
      _sum: { total_balance: true },
    });

    const beforeImports = await prisma.transaction.findMany({
      where: { type: "IMPORT" },
      select: {
        id: true, beneficiary_id: true, facility_id: true, company_id: true,
        amount: true, is_cancelled: true, created_at: true,
        original_transaction_id: true, idempotency_key: true,
      },
      orderBy: { id: "asc" },
    });
    expect(beforeImports.length).toBeGreaterThan(0);
    const affectedIds = [...new Set(beforeImports.map((tx) => tx.beneficiary_id).concat(familyMembers.map((m) => m.id)))];
    const beforeMembers = await prisma.beneficiary.findMany({
      where: { id: { in: affectedIds } },
      select: { id: true, total_balance: true, remaining_balance: true, status: true, completed_via: true },
      orderBy: { id: "asc" },
    });
    const beforeArchive = await prisma.familyImportArchive.findMany({ orderBy: { id: "asc" } });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Import");
    sheet.addRow(["رقم البطاقة", "الاسم", "عدد الأفراد", "الرصيد الكلي", "الرصيد المستخدم"]);
    sheet.addRow([
      candidate.card_number,
      "اختبار استبدال الحركات",
      familyMembers.length,
      Number(familyTotal._sum.total_balance) || Number(candidate.total_balance),
      1,
    ]);

    const imported = await processTransactionImport(Buffer.from(await workbook.xlsx.writeBuffer()), username, facilityId, {
      replaceOldImports: true,
      purgeMissingFamilies: false,
      cleanupOldSettlements: false,
      sourceFileName: "isolated-replace-import-test.xlsx",
    });
    expect(imported.error).toBeUndefined();
    expect(imported.result?.cleanupDeletedImportTransactions).toBe(beforeImports.length);

    const { POST } = await import("@/app/api/import-transactions/rollback/[logId]/route");
    const response = await POST(new Request("http://localhost/rollback", { method: "POST" }), {
      params: Promise.resolve({ logId: imported.result!.auditLogId }),
    });
    expect(response.status).toBe(200);

    const afterImports = await prisma.transaction.findMany({
      where: { type: "IMPORT" },
      select: {
        id: true, beneficiary_id: true, facility_id: true, company_id: true,
        amount: true, is_cancelled: true, created_at: true,
        original_transaction_id: true, idempotency_key: true,
      },
      orderBy: { id: "asc" },
    });
    const normalizeImports = (rows: typeof beforeImports) => rows.map((row) => ({
      ...row, amount: Number(row.amount), created_at: row.created_at.toISOString(),
    }));
    expect(normalizeImports(afterImports)).toEqual(normalizeImports(beforeImports));

    const afterMembers = await prisma.beneficiary.findMany({
      where: { id: { in: affectedIds } },
      select: { id: true, total_balance: true, remaining_balance: true, status: true, completed_via: true },
      orderBy: { id: "asc" },
    });
    const normalizeMembers = (rows: typeof beforeMembers) => rows.map((row) => ({
      ...row, total_balance: Number(row.total_balance), remaining_balance: Number(row.remaining_balance),
    }));
    expect(normalizeMembers(afterMembers)).toEqual(normalizeMembers(beforeMembers));
    expect(await prisma.familyImportArchive.findMany({ orderBy: { id: "asc" } })).toEqual(beforeArchive);
  }, 240_000);
});
