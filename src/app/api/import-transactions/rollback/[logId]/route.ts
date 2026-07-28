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
  companyId: string | null;
  amount: number;
  type: "IMPORT";
  isCancelled: boolean;
  createdAt: string;
  originalTransactionId: string | null;
  idempotencyKey: string | null;
};

type FamilyArchiveBeforeSnapshot = {
  companyId: string;
  familyBaseCard: string;
  familyCountFromFile: number;
  totalBalanceFromFile: number;
  usedBalanceFromFile: number;
  sourceRowNumber: number | null;
  importedBy: string;
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
  if (!session || session.role_v2 !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "ممنوع - المبرمجون فقط" }, { status: 403 });
  }

  const { logId } = await params;
  const importLog = await prisma.auditLog.findUnique({
    where: { id: logId },
    select: { id: true, action: true, metadata: true, company_id: true },
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
          company_id: oldTx.companyId,
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
      const rowsToUpsert = beforeArchiveRows.filter((row): row is FamilyArchiveBeforeSnapshot =>
        Boolean(row?.companyId && affectedFamilies.includes(row.familyBaseCard)),
      );

      let restoredArchiveRows = 0;
      let deletedArchiveRows = 0;

      const deleted = await tx.familyImportArchive.deleteMany({
        where: { family_base_card: { in: affectedFamilies } },
      });
      deletedArchiveRows = deleted.count;

      for (const row of rowsToUpsert) {
        await tx.familyImportArchive.create({
          data: {
            company_id: row.companyId,
            family_base_card: row.familyBaseCard,
            family_count_from_file: row.familyCountFromFile,
            total_balance_from_file: row.totalBalanceFromFile,
            used_balance_from_file: row.usedBalanceFromFile,
            source_row_number: row.sourceRowNumber,
            imported_by: row.importedBy,
            last_imported_at: new Date(row.lastImportedAt),
            created_at: new Date(row.createdAt),
            updated_at: new Date(row.updatedAt),
          },
        });
        restoredArchiveRows++;
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
          company_id: importLog.company_id,
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
