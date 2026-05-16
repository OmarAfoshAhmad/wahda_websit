import prisma from "@/lib/prisma";
import { roundCurrency } from "@/lib/money";
  import type { FamilyImportArchiveSnapshot } from "./types";
import type { FamilyImportArchive } from "@prisma/client";

export async function loadFamilyArchiveSnapshot(baseCards: string[]): Promise<FamilyImportArchiveSnapshot[]> {
  if (baseCards.length === 0) return [];

  const rows = await prisma.familyImportArchive.findMany({
    where: {
      family_base_card: { in: baseCards }
    },
    orderBy: {
      family_base_card: 'asc'
    }
  });

  return rows.map((row: FamilyImportArchive) => ({
    familyBaseCard: row.family_base_card,
    familyCountFromFile: row.family_count_from_file,
    totalBalanceFromFile: Number(row.total_balance_from_file) || 0,
    usedBalanceFromFile: Number(row.used_balance_from_file) || 0,
    sourceRowNumber: row.source_row_number,
    importedBy: row.imported_by,
    lastImportedAt: row.last_imported_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function deleteFamilyImportArchiveRows(baseCards: string[]): Promise<number> {
  if (baseCards.length === 0) return 0;
  const result = await prisma.familyImportArchive.deleteMany({
    where: {
      family_base_card: { in: baseCards }
    }
  });
  return result.count;
}

export async function findImportBaseCardsMissingFromFile(importFacilityId: string, keepBaseCards: string[]): Promise<string[]> {
  const keepSet = new Set(keepBaseCards.map((x) => String(x ?? "").trim()).filter(Boolean));

  const rows = await prisma.$queryRaw<Array<{ family_base_card: string }>>`
    SELECT DISTINCT
      regexp_replace(b.card_number, '(?:[DWSH]\\d+|[MF]\\d*)$', '', 'i') AS family_base_card
    FROM "Transaction" t
    JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    WHERE t.type = 'IMPORT'
      AND t.is_cancelled = false
      AND t.facility_id = ${importFacilityId}
      AND b.deleted_at IS NULL
  `;

  return rows
    .map((r) => String(r.family_base_card ?? "").trim().toUpperCase())
    .filter((baseCard) => /^WAB2025\d+$/.test(baseCard))
    .filter((baseCard) => !keepSet.has(baseCard));
}

export async function upsertFamilyImportArchive(input: {
  familyBaseCard: string;
  familyCount: number;
  totalBalanceFromFile: number;
  usedBalanceFromFile: number;
  sourceRowNumber: number;
  importedBy: string;
}) {
  const familyCount = Math.max(0, Math.floor(Number(input.familyCount) || 0));
  const totalBalance = roundCurrency(Number(input.totalBalanceFromFile) || 0);
  const usedBalance = roundCurrency(Number(input.usedBalanceFromFile) || 0);
  const sourceRowNumber = Math.max(0, Math.floor(Number(input.sourceRowNumber) || 0));

  await prisma.familyImportArchive.upsert({
    where: { family_base_card: input.familyBaseCard },
    update: {
      family_count_from_file: familyCount,
      total_balance_from_file: totalBalance,
      used_balance_from_file: usedBalance,
      source_row_number: sourceRowNumber,
      imported_by: input.importedBy,
      last_imported_at: new Date(),
    },
    create: {
      family_base_card: input.familyBaseCard,
      family_count_from_file: familyCount,
      total_balance_from_file: totalBalance,
      used_balance_from_file: usedBalance,
      source_row_number: sourceRowNumber,
      imported_by: input.importedBy,
      last_imported_at: new Date(),
    }
  });
}
