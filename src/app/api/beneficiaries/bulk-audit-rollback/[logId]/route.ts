import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ logId: string }> },
) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_recycle_bin")) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { logId } = await params;

  const auditLog = await prisma.auditLog.findUnique({
    where: { id: logId },
    select: { id: true, action: true, metadata: true },
  });

  if (!auditLog) {
    return NextResponse.json({ error: "سجل المراقبة غير موجود" }, { status: 404 });
  }

  if (
    auditLog.action !== "BULK_DELETE_BENEFICIARY"
    && auditLog.action !== "BULK_RESTORE_BENEFICIARY"
    && auditLog.action !== "BULK_RENEW_BALANCE"
  ) {
    return NextResponse.json({ error: "هذه العملية لا تدعم التراجع" }, { status: 400 });
  }

  const metadata = (auditLog.metadata ?? {}) as Record<string, unknown>;
  if (metadata.undo_reverted_at) {
    return NextResponse.json({ error: "تم التراجع عن هذه العملية مسبقاً" }, { status: 400 });
  }

  const details = Array.isArray(metadata.details)
    ? (metadata.details as Array<Record<string, unknown>>)
    : [];

  const renewUndoSnapshot = Array.isArray(metadata.undo_snapshot)
    ? (metadata.undo_snapshot as Array<Record<string, unknown>>)
    : [];

  if (auditLog.action !== "BULK_RENEW_BALANCE" && details.length === 0) {
    return NextResponse.json({ error: "لا توجد تفاصيل كافية للتراجع" }, { status: 400 });
  }
  if (auditLog.action === "BULK_RENEW_BALANCE" && renewUndoSnapshot.length === 0) {
    return NextResponse.json({ error: "لا توجد بيانات تراجع لتجديد الرصيد" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    let revertedCount = 0;

    for (const item of details) {
      const beneficiaryId = String(item.beneficiary_id ?? "").trim();
      if (!beneficiaryId) continue;

      if (auditLog.action === "BULK_DELETE_BENEFICIARY") {
        const shouldRevert = String(item.result ?? "") === "deleted";
        if (!shouldRevert) continue;

        await tx.beneficiary.updateMany({
          where: { id: beneficiaryId, deleted_at: { not: null } },
          data: { deleted_at: null },
        });
        revertedCount += 1;
      }

      if (auditLog.action === "BULK_RESTORE_BENEFICIARY") {
        const shouldRevert = String(item.result ?? "") === "restored";
        if (!shouldRevert) continue;

        const beforeDeletedAtRaw = item.before_deleted_at;
        if (typeof beforeDeletedAtRaw !== "string" || beforeDeletedAtRaw.trim().length === 0) {
          continue;
        }

        const beforeDeletedAt = new Date(beforeDeletedAtRaw);
        if (Number.isNaN(beforeDeletedAt.getTime())) {
          continue;
        }

        await tx.beneficiary.updateMany({
          where: { id: beneficiaryId, deleted_at: null },
          data: { deleted_at: beforeDeletedAt },
        });
        revertedCount += 1;
      }

      if (auditLog.action === "BULK_RENEW_BALANCE") {
        // يتم تنفيذ هذا الفرع لاحقاً من undo_snapshot
        continue;
      }
    }

    if (auditLog.action === "BULK_RENEW_BALANCE") {
      for (const item of renewUndoSnapshot) {
        const beneficiaryId = String(item.id ?? "").trim();
        if (!beneficiaryId) continue;

        const totalBefore = Number(item.total_before ?? 0);
        const remainingBefore = Number(item.remaining_before ?? 0);
        const statusBefore = String(item.status_before ?? "ACTIVE") as "ACTIVE" | "FINISHED" | "SUSPENDED";

        await tx.beneficiary.updateMany({
          where: { id: beneficiaryId },
          data: {
            total_balance: totalBefore,
            remaining_balance: remainingBefore,
            status: statusBefore,
          },
        });

        revertedCount += 1;
      }
    }

    await tx.auditLog.update({
      where: { id: logId },
      data: {
        metadata: {
          ...metadata,
          undo_reverted_at: new Date().toISOString(),
          undo_reverted_by: session.username,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: auditLog.action === "BULK_DELETE_BENEFICIARY"
          ? "UNDO_BULK_DELETE_BENEFICIARY"
          : auditLog.action === "BULK_RESTORE_BENEFICIARY"
            ? "UNDO_BULK_RESTORE_BENEFICIARY"
            : "UNDO_BULK_RENEW_BALANCE",
        metadata: {
          original_audit_log_id: logId,
          reverted_count: revertedCount,
        },
      },
    });

    return { revertedCount };
  });

  return NextResponse.json({ success: true, revertedCount: result.revertedCount });
}
