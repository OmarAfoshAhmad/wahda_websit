import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

function extractFamilyBaseCard(cardNumber: string): string {
  const normalized = String(cardNumber ?? "").trim().toUpperCase();
  const match = normalized.match(/^(.*?)([WSDMFHV])(\d+)$/i);
  return match ? match[1] : normalized;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function ensureFamilyImportArchiveTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FamilyImportArchive" (
      "family_base_card" TEXT PRIMARY KEY,
      "family_count_from_file" INTEGER NOT NULL DEFAULT 0,
      "total_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
      "used_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
      "source_row_number" INTEGER,
      "imported_by" TEXT,
      "source_file_name" TEXT,
      "last_imported_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "FamilyImportArchive"
    ADD COLUMN IF NOT EXISTS "source_file_name" TEXT;
  `);
}

function extractImportSourceFileName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  if (obj.kind !== "TRANSACTION_IMPORT") return null;
  const source = obj.sourceFileName;
  if (typeof source !== "string") return null;
  const clean = source.trim();
  return clean.length > 0 ? clean : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "view_beneficiaries")) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;
  const beneficiaryId = String(id ?? "").trim();
  if (!beneficiaryId) {
    return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });
  }

  const beneficiary = await prisma.beneficiary.findFirst({
    where: { id: beneficiaryId },
    select: {
      id: true,
      name: true,
      card_number: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      deleted_at: true,
    },
  });

  if (!beneficiary) {
    return NextResponse.json({ error: "المستفيد غير موجود" }, { status: 404 });
  }

  await ensureFamilyImportArchiveTable();

  const familyBaseCard = extractFamilyBaseCard(beneficiary.card_number);
  const familyCandidates = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      card_number: { startsWith: familyBaseCard, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      card_number: true,
      status: true,
      total_balance: true,
      remaining_balance: true,
    },
    orderBy: [{ card_number: "asc" }, { created_at: "asc" }],
    take: 250,
  });

  const familyMembers = familyCandidates
    .filter((m) => extractFamilyBaseCard(m.card_number) === familyBaseCard)
    .map((m) => ({
      id: m.id,
      name: m.name,
      card_number: m.card_number,
      status: m.status,
      total_balance: Number(m.total_balance),
      remaining_balance: Number(m.remaining_balance),
      is_selected: m.id === beneficiary.id,
    }));

  const familyArchiveRows = await prisma.$queryRaw<Array<{
    family_count_from_file: number;
    total_balance_from_file: number;
    used_balance_from_file: number;
    source_file_name: string | null;
    imported_by: string | null;
    last_imported_at: Date;
  }>>`
    SELECT
      "family_count_from_file"::int AS family_count_from_file,
      "total_balance_from_file"::float8 AS total_balance_from_file,
      "used_balance_from_file"::float8 AS used_balance_from_file,
      "source_file_name",
      "imported_by",
      "last_imported_at"
    FROM "FamilyImportArchive"
    WHERE "family_base_card" = ${familyBaseCard}
    LIMIT 1
  `;
  const familyArchive = familyArchiveRows[0] ?? null;

  const familyMemberIds = familyMembers.map((m) => m.id);
  const familySystemSpendingAll = familyMemberIds.length > 0
    ? await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        beneficiary_id: { in: familyMemberIds },
        is_cancelled: false,
        type: { not: "CANCELLATION" },
      },
    })
    : null;

  const familyImportSpending = familyMemberIds.length > 0
    ? await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        beneficiary_id: { in: familyMemberIds },
        is_cancelled: false,
        type: "IMPORT",
      },
    })
    : null;

  const transactions = await prisma.transaction.findMany({
    where: { beneficiary_id: beneficiaryId },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: 500,
    select: {
      id: true,
      amount: true,
      type: true,
      is_cancelled: true,
      created_at: true,
      facility: { select: { name: true } },
      original_transaction_id: true,
    },
  });

  const recentImportJobs = await prisma.importJob.findMany({
    where: { status: "COMPLETED" },
    select: {
      completed_at: true,
      payload: true,
    },
    orderBy: { completed_at: "desc" },
    take: 300,
  });

  const importJobFileNames = recentImportJobs
    .map((job) => {
      const sourceFileName = extractImportSourceFileName(job.payload);
      if (!job.completed_at || !sourceFileName) return null;
      return {
        completedAt: job.completed_at,
        sourceFileName,
      };
    })
    .filter((job): job is { completedAt: Date; sourceFileName: string } => job !== null);

  const findClosestImportFileName = (createdAt: Date): string | null => {
    if (importJobFileNames.length === 0) return null;
    let best: { sourceFileName: string; delta: number } | null = null;
    for (const job of importJobFileNames) {
      const delta = Math.abs(createdAt.getTime() - job.completedAt.getTime());
      if (!best || delta < best.delta) {
        best = { sourceFileName: job.sourceFileName, delta };
      }
    }
    // نافذة مطابقة واسعة نسبيًا لأن الاستيراد قد يمتد على دقائق طويلة.
    const maxDeltaMs = 12 * 60 * 60 * 1000;
    return best && best.delta <= maxDeltaMs ? best.sourceFileName : null;
  };

  const activeTx = transactions.filter((t) => !t.is_cancelled);
  const totalUsed = activeTx
    .filter((t) => t.type !== "CANCELLATION")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const familyTotalBalanceSystem = round2(
    familyMembers.reduce((sum, member) => sum + Number(member.total_balance || 0), 0),
  );
  const familyRemainingBalanceSystem = round2(
    familyMembers.reduce((sum, member) => sum + Number(member.remaining_balance || 0), 0),
  );
  const familyDistributedFromSystem = round2(Number(familySystemSpendingAll?._sum.amount ?? 0));
  const familyDistributedFromImportOnly = round2(Number(familyImportSpending?._sum.amount ?? 0));
  const familyDebtToCompany = round2(Math.max(0, familyDistributedFromSystem - familyTotalBalanceSystem));
  const expectedFromFile = familyArchive ? round2(Number(familyArchive.used_balance_from_file ?? 0)) : null;
  const importDistributionDiff = expectedFromFile === null
    ? null
    : round2(familyDistributedFromImportOnly - expectedFromFile);
  const importDistributionIsMatch = importDistributionDiff === null
    ? null
    : Math.abs(importDistributionDiff) <= 0.01;

  return NextResponse.json({
    item: {
      beneficiary: {
        id: beneficiary.id,
        name: beneficiary.name,
        card_number: beneficiary.card_number,
        total_balance: Number(beneficiary.total_balance),
        remaining_balance: Number(beneficiary.remaining_balance),
        status: beneficiary.status,
        deleted_at: beneficiary.deleted_at,
      },
      family: {
        base_card: familyBaseCard,
        members_count: familyMembers.length,
        members: familyMembers,
      },
      family_financials: {
        source: {
          file_name: familyArchive?.source_file_name ?? null,
          imported_by: familyArchive?.imported_by ?? null,
          last_imported_at: familyArchive?.last_imported_at ?? null,
          family_count_from_file: familyArchive ? Number(familyArchive.family_count_from_file ?? 0) : null,
          total_balance_from_file: familyArchive ? round2(Number(familyArchive.total_balance_from_file ?? 0)) : null,
          used_balance_from_file: familyArchive ? round2(Number(familyArchive.used_balance_from_file ?? 0)) : null,
        },
        system: {
          family_members_in_system: familyMembers.length,
          family_total_balance: familyTotalBalanceSystem,
          family_remaining_balance: familyRemainingBalanceSystem,
          distributed_from_system: familyDistributedFromSystem,
          distributed_from_import_only: familyDistributedFromImportOnly,
          debt_to_company: familyDebtToCompany,
        },
        import_reconciliation: {
          expected_from_file: expectedFromFile,
          applied_import_only: familyDistributedFromImportOnly,
          diff: importDistributionDiff,
          is_match: importDistributionIsMatch,
        },
      },
      summary: {
        transactions_count: transactions.length,
        active_transactions_count: activeTx.length,
        cancelled_transactions_count: transactions.length - activeTx.length,
        total_used: Math.round(totalUsed * 100) / 100,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        type: t.type,
        is_cancelled: t.is_cancelled,
        created_at: t.created_at,
        facility_name: t.facility?.name ?? "-",
        original_transaction_id: t.original_transaction_id,
        import_source_file_name: t.type === "IMPORT"
          ? (familyArchive?.source_file_name ?? findClosestImportFileName(t.created_at) ?? null)
          : null,
      })),
    },
  });
}
