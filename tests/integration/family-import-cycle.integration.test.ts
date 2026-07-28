import { beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { processTransactionImport } from "@/lib/import-transactions/core";

const sessionState = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("@/lib/session-guard", () => ({
  requireActiveFacilitySession: vi.fn(async () => sessionState.session),
}));

type Candidate = {
  family_base_card: string;
  company_id: string;
  family_count: number;
  total_balance: number;
};

describe("family allocation import and rollback cycle", () => {
  let username: string;
  let facilityId: string;

  beforeAll(async () => {
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(databaseName).toMatch(/test|testing|snapshot/i);

    const facility = await prisma.facility.findFirst({
      where: { role_v2: "SUPER_ADMIN", deleted_at: null },
      select: { id: true, username: true },
    });
    if (!facility) throw new Error("No active SUPER_ADMIN facility found");
    username = facility.username;
    facilityId = facility.id;
    sessionState.session = { id: facility.id, username: facility.username, role_v2: "SUPER_ADMIN" };
  });

  it("restores balances, imports, and company archive after rollback", async () => {
    const candidates = await prisma.$queryRaw<Candidate[]>`
      WITH heads AS (
        SELECT id, card_number AS family_base_card, company_id
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          AND company_id IS NOT NULL
          AND card_number ~ '^WAB2025[0-9]+$'
      ), families AS (
        SELECT
          h.family_base_card,
          h.company_id,
          COUNT(*)::int AS family_count,
          SUM(b.total_balance)::float8 AS total_balance,
          COUNT(DISTINCT b.company_id)::int AS company_count,
          COUNT(t.id) FILTER (WHERE t.type = 'IMPORT' AND t.is_cancelled = false)::int AS import_count
        FROM heads h
        JOIN "Beneficiary" b
          ON b.company_id = h.company_id
          AND b.deleted_at IS NULL
          AND (b.card_number = h.family_base_card OR b.card_number ~ ('^' || h.family_base_card || '[WSDMFHV][0-9]*$'))
        LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
        GROUP BY h.family_base_card, h.company_id
      )
      SELECT family_base_card, company_id, family_count, total_balance
      FROM families
      WHERE company_count = 1 AND import_count = 0 AND total_balance >= 10
      ORDER BY family_base_card
      LIMIT 1
    `;
    const candidate = candidates[0];
    if (!candidate) throw new Error("No safe family without previous IMPORT transactions found");

    const memberWhere = {
      company_id: candidate.company_id,
      deleted_at: null,
      card_number: { startsWith: candidate.family_base_card },
    } as const;
    const head = await prisma.beneficiary.findFirstOrThrow({
      where: { ...memberWhere, card_number: candidate.family_base_card },
      select: { id: true },
    });
    const preexistingImport = await prisma.transaction.create({
      data: {
        beneficiary_id: head.id,
        facility_id: facilityId,
        company_id: candidate.company_id,
        amount: 2,
        type: "IMPORT",
      },
    });
    const beforeMembers = await prisma.beneficiary.findMany({
      where: memberWhere,
      select: { id: true, total_balance: true, remaining_balance: true, status: true, completed_via: true },
      orderBy: { id: "asc" },
    });
    const beforeArchive = await prisma.familyImportArchive.findUnique({
      where: { company_id_family_base_card: { company_id: candidate.company_id, family_base_card: candidate.family_base_card } },
    });
    const beforeImports = await prisma.transaction.findMany({
      where: { beneficiary_id: { in: beforeMembers.map((member) => member.id) }, type: "IMPORT", is_cancelled: false },
      select: { id: true, beneficiary_id: true, facility_id: true, company_id: true, amount: true },
      orderBy: { id: "asc" },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Import");
    sheet.addRow(["رقم البطاقة", "الاسم", "عدد الأفراد", "الرصيد الكلي", "الرصيد المستخدم"]);
    sheet.addRow([candidate.family_base_card, "اختبار دورة الاستيراد", candidate.family_count, candidate.total_balance, 1]);
    const fileBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const imported = await processTransactionImport(fileBuffer, username, facilityId, {
      replaceOldImports: false,
      purgeMissingFamilies: false,
      cleanupOldSettlements: false,
      sourceFileName: "isolated-import-cycle-test.xlsx",
    });
    expect(imported.error).toBeUndefined();
    expect(imported.result?.auditLogId).toBeTruthy();

    const importsDuring = await prisma.transaction.findMany({
      where: { beneficiary_id: { in: beforeMembers.map((member) => member.id) }, type: "IMPORT", is_cancelled: false },
      select: { id: true, beneficiary_id: true, facility_id: true, company_id: true, amount: true },
      orderBy: { id: "asc" },
    });
    expect(importsDuring.map((tx) => ({ ...tx, amount: Number(tx.amount) })))
      .not.toEqual(beforeImports.map((tx) => ({ ...tx, amount: Number(tx.amount) })));
    expect(await prisma.familyImportArchive.findUnique({
      where: { company_id_family_base_card: { company_id: candidate.company_id, family_base_card: candidate.family_base_card } },
    })).not.toBeNull();

    const { POST } = await import("@/app/api/import-transactions/rollback/[logId]/route");
    const response = await POST(new Request("http://localhost/rollback", { method: "POST" }), {
      params: Promise.resolve({ logId: imported.result!.auditLogId }),
    });
    expect(response.status).toBe(200);

    const afterMembers = await prisma.beneficiary.findMany({
      where: memberWhere,
      select: { id: true, total_balance: true, remaining_balance: true, status: true, completed_via: true },
      orderBy: { id: "asc" },
    });
    expect(afterMembers.map((m) => ({ ...m, total_balance: Number(m.total_balance), remaining_balance: Number(m.remaining_balance) })))
      .toEqual(beforeMembers.map((m) => ({ ...m, total_balance: Number(m.total_balance), remaining_balance: Number(m.remaining_balance) })));
    const afterImports = await prisma.transaction.findMany({
      where: { beneficiary_id: { in: beforeMembers.map((member) => member.id) }, type: "IMPORT", is_cancelled: false },
      select: { id: true, beneficiary_id: true, facility_id: true, company_id: true, amount: true },
      orderBy: { id: "asc" },
    });
    expect(afterImports.map((tx) => ({ ...tx, amount: Number(tx.amount) })))
      .toEqual(beforeImports.map((tx) => ({ ...tx, amount: Number(tx.amount) })));

    const afterArchive = await prisma.familyImportArchive.findUnique({
      where: { company_id_family_base_card: { company_id: candidate.company_id, family_base_card: candidate.family_base_card } },
    });
    expect(afterArchive).toEqual(beforeArchive);
    await prisma.transaction.delete({ where: { id: preexistingImport.id } });
  }, 180_000);
});
