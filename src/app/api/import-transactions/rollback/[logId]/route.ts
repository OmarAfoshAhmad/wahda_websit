import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { Prisma } from "@prisma/client";

type BalanceStatus = "ACTIVE" | "FINISHED" | "SUSPENDED";

type MemberBeforeSnapshot = {
  beneficiaryId: string;
  beneficiaryName: string;
  cardNumber: string;
  totalBalance: number;
  remainingBalance: number;
  status: BalanceStatus;
  completedVia: string | null;
};

type DeletedImportTransactionSnapshot = {
  id: string;
  beneficiaryId: string;
  facilityId: string;
  amount: number;
  type: "IMPORT";
  isCancelled: boolean;
  createdAt: string;
  originalTransactionId: string | null;
  idempotencyKey: string | null;
};

type FamilyArchiveBeforeSnapshot = {
  familyBaseCard: string;
  familyCountFromFile: number;
  totalBalanceFromFile: number;
  usedBalanceFromFile: number;
  sourceRowNumber: number | null;
  importedBy: string | null;
  lastImportedAt: string;
  createdAt: string;
  updatedAt: string;
};

type RollbackSnapshot = {
  affectedFamilies: string[];
  affectedMemberIds: string[];
  membersBefore: MemberBeforeSnapshot[];
  deletedOldImportTransactions: DeletedImportTransactionSnapshot[];
  familyArchiveBefore: FamilyArchiveBeforeSnapshot[];
};

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function asRollbackSnapshot(metadata: Record<string, unknown>): RollbackSnapshot | null {
  const detailedReport = metadata.detailedReport as Record<string, unknown> | undefined;
  if (!detailedReport || typeof detailedReport !== "object") return null;

  const rollbackSnapshot = detailedReport.rollbackSnapshot as Record<string, unknown> | undefined;
  if (!rollbackSnapshot || typeof rollbackSnapshot !== "object") return null;

  return rollbackSnapshot as unknown as RollbackSnapshot;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ logId: string }> },
) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return NextResponse.json({ error: "ممنوع - المبرمجون فقط" }, { status: 403 });
  }

  const { logId } = await params;
  const importLog = await prisma.auditLog.findUnique({
    where: { id: logId },
    select: { id: true, action: true, metadata: true },
  });

  if (!importLog) {
    return NextResponse.json({ error: "سجل الاستيراد غير موجود" }, { status: 404 });
  }

  if (importLog.action !== "IMPORT_TRANSACTIONS") {
    return NextResponse.json({ error: "هذه ليست عملية استيراد قابلة للتراجع" }, { status: 400 });
  }

  const metadata = (importLog.metadata ?? {}) as Record<string, unknown>;
  const rollbackStatus = String(metadata.rollbackStatus ?? "not_rolled_back");
  if (rollbackStatus === "rolled_back") {
    return NextResponse.json({ error: "تم التراجع عن هذه العملية مسبقا" }, { status: 400 });
  }

  const snapshot = asRollbackSnapshot(metadata);
  if (!snapshot) {
    return NextResponse.json({ error: "لا توجد بيانات تراجع كافية داخل سجل الاستيراد" }, { status: 400 });
  }

  const affectedMemberIds = Array.from(new Set((snapshot.affectedMemberIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)));
  const affectedFamilies = Array.from(new Set((snapshot.affectedFamilies ?? []).map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (affectedMemberIds.length === 0) {
    return NextResponse.json({ error: "قائمة المستفيدين المتأثرين فارغة" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const preRollbackMembers = await tx.beneficiary.findMany({
        where: { id: { in: affectedMemberIds } },
        select: {
          id: true,
          name: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
        },
        orderBy: { card_number: "asc" },
      });

      let deletedCurrentImportsCount = 0;
      for (const beneficiaryChunk of chunkArray(affectedMemberIds, 1500)) {
        const deletedCurrentImports = await tx.transaction.deleteMany({
          where: {
            beneficiary_id: { in: beneficiaryChunk },
            type: "IMPORT",
            is_cancelled: false,
          },
        });
        deletedCurrentImportsCount += deletedCurrentImports.count;
      }

      const toRestoreTransactions = (Array.isArray(snapshot.deletedOldImportTransactions)
        ? snapshot.deletedOldImportTransactions
        : [])
        .map((oldTx) => ({
          id: oldTx.id,
          beneficiary_id: oldTx.beneficiaryId,
          facility_id: oldTx.facilityId,
          amount: oldTx.amount,
          type: "IMPORT" as const,
          is_cancelled: Boolean(oldTx.isCancelled),
          created_at: new Date(oldTx.createdAt),
          original_transaction_id: oldTx.originalTransactionId,
          idempotency_key: oldTx.idempotencyKey,
        }))
        .filter((oldTx) => !Number.isNaN(oldTx.created_at.getTime()));

      let restoredOldTransactions = 0;
      if (toRestoreTransactions.length > 0) {
        const created = await tx.transaction.createMany({
          data: toRestoreTransactions,
          skipDuplicates: false,
        });
        restoredOldTransactions = created.count;
      }

      const membersBefore = Array.isArray(snapshot.membersBefore) ? snapshot.membersBefore : [];

      let restoredBalances = 0;
      for (const memberChunk of chunkArray(membersBefore, 1200)) {
        if (memberChunk.length === 0) continue;
        const memberValues = memberChunk.map((m) =>
          Prisma.sql`(${m.beneficiaryId}, ${m.totalBalance}, ${m.remainingBalance}, ${m.status}, ${m.completedVia})`,
        );

        await tx.$executeRaw(Prisma.sql`
          UPDATE "Beneficiary" AS b
          SET
            total_balance = v.total_balance::numeric,
            remaining_balance = v.remaining_balance::numeric,
            status = v.status::"BeneficiaryStatus",
            completed_via = v.completed_via
          FROM (
            VALUES ${Prisma.join(memberValues)}
          ) AS v(id, total_balance, remaining_balance, status, completed_via)
          WHERE b.id = v.id
        `);
        restoredBalances += memberChunk.length;
      }

      const beforeArchiveRows = Array.isArray(snapshot.familyArchiveBefore) ? snapshot.familyArchiveBefore : [];
      const beforeArchiveMap = new Map(beforeArchiveRows.map((r) => [r.familyBaseCard, r]));

      const rowsToUpsert = affectedFamilies
        .map((familyBaseCard) => beforeArchiveMap.get(familyBaseCard))
        .filter((row): row is FamilyArchiveBeforeSnapshot => Boolean(row));
      const familiesToDelete = affectedFamilies.filter((familyBaseCard) => !beforeArchiveMap.has(familyBaseCard));

      let restoredArchiveRows = 0;
      let deletedArchiveRows = 0;

      for (const archiveChunk of chunkArray(rowsToUpsert, 900)) {
        if (archiveChunk.length === 0) continue;
        const archiveValues = archiveChunk.map((row) =>
          Prisma.sql`(
            ${row.familyBaseCard},
            ${row.familyCountFromFile},
            ${row.totalBalanceFromFile},
            ${row.usedBalanceFromFile},
            ${row.sourceRowNumber},
            ${row.importedBy},
            ${new Date(row.lastImportedAt)},
            ${new Date(row.createdAt)},
            ${new Date(row.updatedAt)}
          )`,
        );

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "FamilyImportArchive" (
            family_base_card,
            family_count_from_file,
            total_balance_from_file,
            used_balance_from_file,
            source_row_number,
            imported_by,
            last_imported_at,
            created_at,
            updated_at
          )
          VALUES ${Prisma.join(archiveValues)}
          ON CONFLICT (family_base_card)
          DO UPDATE SET
            family_count_from_file = EXCLUDED.family_count_from_file,
            total_balance_from_file = EXCLUDED.total_balance_from_file,
            used_balance_from_file = EXCLUDED.used_balance_from_file,
            source_row_number = EXCLUDED.source_row_number,
            imported_by = EXCLUDED.imported_by,
            last_imported_at = EXCLUDED.last_imported_at,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
        `);

        restoredArchiveRows += archiveChunk.length;
      }

      for (const deleteChunk of chunkArray(familiesToDelete, 5000)) {
        if (deleteChunk.length === 0) continue;
        const deleted = await tx.$executeRaw(Prisma.sql`
          DELETE FROM "FamilyImportArchive"
          WHERE family_base_card IN (${Prisma.join(deleteChunk)})
        `);
        deletedArchiveRows += Number(deleted) || 0;
      }

      const postRollbackMembers = await tx.beneficiary.findMany({
        where: { id: { in: affectedMemberIds } },
        select: {
          id: true,
          name: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
        },
        orderBy: { card_number: "asc" },
      });

      const rollbackReport = {
        sourceImportAuditId: importLog.id,
        affectedFamilies,
        affectedMembers: affectedMemberIds.length,
        deletedCurrentImportTransactions: deletedCurrentImportsCount,
        restoredOldImportTransactions: restoredOldTransactions,
        restoredBalances,
        restoredFamilyArchiveRows: restoredArchiveRows,
        deletedFamilyArchiveRows: deletedArchiveRows,
        preRollbackMembers: preRollbackMembers.map((m) => ({
          beneficiaryId: m.id,
          beneficiaryName: m.name,
          cardNumber: m.card_number,
          totalBalance: Number(m.total_balance) || 0,
          remainingBalance: Number(m.remaining_balance) || 0,
          status: m.status,
          completedVia: m.completed_via,
        })),
        postRollbackMembers: postRollbackMembers.map((m) => ({
          beneficiaryId: m.id,
          beneficiaryName: m.name,
          cardNumber: m.card_number,
          totalBalance: Number(m.total_balance) || 0,
          remainingBalance: Number(m.remaining_balance) || 0,
          status: m.status,
          completedVia: m.completed_via,
        })),
      };

      const rollbackAudit = await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "ROLLBACK_IMPORT",
          metadata: rollbackReport,
        },
        select: { id: true },
      });

      await tx.auditLog.update({
        where: { id: importLog.id },
        data: {
          metadata: {
            ...metadata,
            rollbackStatus: "rolled_back",
            rollbackAt: new Date().toISOString(),
            rollbackBy: session.username,
            rollbackAuditId: rollbackAudit.id,
          },
        },
      });

      return {
        rollbackAuditId: rollbackAudit.id,
        ...rollbackReport,
      };
    }, {
      maxWait: 20_000,
      timeout: 180_000,
    });

    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر تنفيذ التراجع";
    return NextResponse.json({ error: `فشل التراجع: ${message}` }, { status: 500 });
  }
}
