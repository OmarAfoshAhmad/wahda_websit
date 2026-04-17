import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";

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

    // حذف IMPORT الحالية لهذه المجموعة ثم إعادة إدراج الحركات القديمة المحفوظة قبل الاستيراد.
    const deletedCurrentImports = await tx.transaction.deleteMany({
      where: {
        beneficiary_id: { in: affectedMemberIds },
        type: "IMPORT",
        is_cancelled: false,
      },
    });

    const toRestoreTransactions = Array.isArray(snapshot.deletedOldImportTransactions)
      ? snapshot.deletedOldImportTransactions
      : [];

    let restoredOldTransactions = 0;
    for (const oldTx of toRestoreTransactions) {
      const createdAt = new Date(oldTx.createdAt);
      if (Number.isNaN(createdAt.getTime())) continue;

      await tx.transaction.create({
        data: {
          id: oldTx.id,
          beneficiary_id: oldTx.beneficiaryId,
          facility_id: oldTx.facilityId,
          amount: oldTx.amount,
          type: "IMPORT",
          is_cancelled: Boolean(oldTx.isCancelled),
          created_at: createdAt,
          original_transaction_id: oldTx.originalTransactionId,
          idempotency_key: oldTx.idempotencyKey,
        },
      });
      restoredOldTransactions += 1;
    }

    const membersBefore = Array.isArray(snapshot.membersBefore) ? snapshot.membersBefore : [];
    const beforeMap = new Map(membersBefore.map((m) => [m.beneficiaryId, m]));

    let restoredBalances = 0;
    for (const beneficiaryId of affectedMemberIds) {
      const before = beforeMap.get(beneficiaryId);
      if (!before) continue;

      await tx.beneficiary.update({
        where: { id: beneficiaryId },
        data: {
          total_balance: before.totalBalance,
          remaining_balance: before.remainingBalance,
          status: before.status,
          completed_via: before.completedVia,
        },
      });
      restoredBalances += 1;
    }

    const beforeArchiveRows = Array.isArray(snapshot.familyArchiveBefore) ? snapshot.familyArchiveBefore : [];
    const beforeArchiveMap = new Map(beforeArchiveRows.map((r) => [r.familyBaseCard, r]));

    let restoredArchiveRows = 0;
    let deletedArchiveRows = 0;

    for (const familyBaseCard of affectedFamilies) {
      const beforeRow = beforeArchiveMap.get(familyBaseCard);
      if (!beforeRow) {
        const deleted = await tx.$executeRaw`
          DELETE FROM "FamilyImportArchive"
          WHERE family_base_card = ${familyBaseCard}
        `;
        deletedArchiveRows += Number(deleted) || 0;
        continue;
      }

      await tx.$executeRaw`
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
        VALUES (
          ${beforeRow.familyBaseCard},
          ${beforeRow.familyCountFromFile},
          ${beforeRow.totalBalanceFromFile},
          ${beforeRow.usedBalanceFromFile},
          ${beforeRow.sourceRowNumber},
          ${beforeRow.importedBy},
          ${new Date(beforeRow.lastImportedAt)},
          ${new Date(beforeRow.createdAt)},
          ${new Date(beforeRow.updatedAt)}
        )
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
      `;
      restoredArchiveRows += 1;
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
      deletedCurrentImportTransactions: deletedCurrentImports.count,
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
  });

  return NextResponse.json({ result }, { status: 200 });
}
