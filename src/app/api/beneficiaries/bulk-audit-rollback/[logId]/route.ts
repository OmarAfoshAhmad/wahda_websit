import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

export async function POST(
  req: Request,
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
    && auditLog.action !== "FIX_PARENT_CARD_PATTERNS"
    && auditLog.action !== "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION"
  ) {
    return NextResponse.json({ error: "هذه العملية لا تدعم التراجع" }, { status: 400 });
  }

  const metadata = (auditLog.metadata ?? {}) as Record<string, unknown>;
  const body = await req.json().catch(() => null) as { targets?: unknown } | null;
  const requestedTargets = Array.isArray(body?.targets)
    ? [...new Set(body!.targets.map((v) => String(v ?? "").trim().toUpperCase()).filter(Boolean))]
    : [];
  const selectiveRequested = auditLog.action === "FIX_PARENT_CARD_PATTERNS" && requestedTargets.length > 0;

  const alreadyRevertedItems = Array.isArray(metadata.undo_reverted_items)
    ? (metadata.undo_reverted_items as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const alreadyRevertedSet = new Set(alreadyRevertedItems);

  if (metadata.undo_reverted_at) {
    return NextResponse.json({ error: "تم التراجع عن هذه العملية مسبقاً" }, { status: 400 });
  }

  const details = Array.isArray(metadata.details)
    ? (metadata.details as Array<Record<string, unknown>>)
    : [];

  const renewUndoSnapshot = Array.isArray(metadata.undo_snapshot)
    ? (metadata.undo_snapshot as Array<Record<string, unknown>>)
    : [];

  if (
    auditLog.action !== "BULK_RENEW_BALANCE"
    && auditLog.action !== "FIX_PARENT_CARD_PATTERNS"
    && auditLog.action !== "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION"
    && details.length === 0
  ) {
    return NextResponse.json({ error: "لا توجد تفاصيل كافية للتراجع" }, { status: 400 });
  }
  if (auditLog.action === "BULK_RENEW_BALANCE" && renewUndoSnapshot.length === 0) {
    return NextResponse.json({ error: "لا توجد بيانات تراجع لتجديد الرصيد" }, { status: 400 });
  }
  if (auditLog.action === "FIX_PARENT_CARD_PATTERNS" && renewUndoSnapshot.length === 0) {
    return NextResponse.json({ error: "لا توجد بيانات تراجع لتحويل نمط البطاقات" }, { status: 400 });
  }
  if (auditLog.action === "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION" && renewUndoSnapshot.length === 0) {
    return NextResponse.json({ error: "لا توجد بيانات تراجع لتصحيح توزيع الاستيراد" }, { status: 400 });
  }

  if (selectiveRequested) {
    const matchingCandidates = renewUndoSnapshot.filter((item) => {
      const id = String(item.id ?? "").trim();
      const oldCard = String(item.old_card_number ?? "").trim().toUpperCase();
      const newCard = String(item.new_card_number ?? "").trim().toUpperCase();
      if (!id || alreadyRevertedSet.has(id)) return false;
      return requestedTargets.includes(id.toUpperCase()) || requestedTargets.includes(oldCard) || requestedTargets.includes(newCard);
    });
    if (matchingCandidates.length === 0) {
      return NextResponse.json({ error: "لا توجد عناصر مطابقة للتراجع الانتقائي" }, { status: 400 });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    let revertedCount = 0;
    const revertedItemsThisCall: string[] = [];

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

      if (auditLog.action === "FIX_PARENT_CARD_PATTERNS") {
        // يتم تنفيذ هذا الفرع لاحقاً من undo_snapshot
        continue;
      }

      if (auditLog.action === "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION") {
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

    if (auditLog.action === "FIX_PARENT_CARD_PATTERNS") {
      for (const item of renewUndoSnapshot) {
        const beneficiaryId = String(item.id ?? "").trim();
        const oldCard = String(item.old_card_number ?? "").trim();
        const newCard = String(item.new_card_number ?? "").trim();
        if (!beneficiaryId || !oldCard || !newCard) continue;
        if (alreadyRevertedSet.has(beneficiaryId)) continue;

        if (selectiveRequested) {
          const tokenSet = new Set([
            beneficiaryId.toUpperCase(),
            oldCard.toUpperCase(),
            newCard.toUpperCase(),
          ]);
          const matchesTarget = requestedTargets.some((target) => tokenSet.has(target));
          if (!matchesTarget) continue;
        }

        const conflict = await tx.beneficiary.findFirst({
          where: {
            deleted_at: null,
            card_number: oldCard,
            id: { not: beneficiaryId },
          },
          select: { id: true },
        });
        if (conflict) continue;

        const updated = await tx.beneficiary.updateMany({
          where: { id: beneficiaryId, card_number: newCard },
          data: { card_number: oldCard },
        });
        if (updated.count > 0) {
          revertedCount += 1;
          revertedItemsThisCall.push(beneficiaryId);
        }
      }
    }

    if (auditLog.action === "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION") {
      for (const familySnapshot of renewUndoSnapshot) {
        const createdIds = Array.isArray(familySnapshot.created_transaction_ids)
          ? (familySnapshot.created_transaction_ids as unknown[]).map((v) => String(v ?? "").trim()).filter(Boolean)
          : [];

        if (createdIds.length > 0) {
          await tx.transaction.deleteMany({
            where: { id: { in: createdIds } },
          });
        }

        const members = Array.isArray(familySnapshot.members)
          ? (familySnapshot.members as Array<Record<string, unknown>>)
          : [];

        for (const memberSnapshot of members) {
          const beneficiaryId = String(memberSnapshot.id ?? "").trim();
          if (!beneficiaryId) continue;

          const beforeRemaining = Number(memberSnapshot.before_remaining_balance ?? 0);
          const beforeStatus = String(memberSnapshot.before_status ?? "ACTIVE") as "ACTIVE" | "FINISHED" | "SUSPENDED";
          const beforeCompletedViaRaw = memberSnapshot.before_completed_via;
          const beforeCompletedVia = typeof beforeCompletedViaRaw === "string" && beforeCompletedViaRaw.trim().length > 0
            ? beforeCompletedViaRaw
            : null;

          await tx.beneficiary.updateMany({
            where: { id: beneficiaryId },
            data: {
              remaining_balance: beforeRemaining,
              status: beforeStatus,
              completed_via: beforeCompletedVia,
            },
          });
          revertedCount += 1;

          const txBefore = Array.isArray(memberSnapshot.tx_before)
            ? (memberSnapshot.tx_before as Array<Record<string, unknown>>)
            : [];

          for (const txItem of txBefore) {
            const txId = String(txItem.id ?? "").trim();
            if (!txId) continue;
            const amount = Number(txItem.amount ?? 0);

            await tx.transaction.updateMany({
              where: { id: txId },
              data: {
                amount,
                is_cancelled: false,
              },
            });
          }
        }
      }
    }

    const nowIso = new Date().toISOString();

    if (auditLog.action === "FIX_PARENT_CARD_PATTERNS") {
      const mergedRevertedItems = [...new Set([...alreadyRevertedItems, ...revertedItemsThisCall])];
      const totalTrackedIds = new Set(
        renewUndoSnapshot
          .map((item) => String(item.id ?? "").trim())
          .filter(Boolean)
      );
      const fullyReverted = totalTrackedIds.size > 0 && mergedRevertedItems.length >= totalTrackedIds.size;

      await tx.auditLog.update({
        where: { id: logId },
        data: {
          metadata: {
            ...metadata,
            undo_reverted_items: mergedRevertedItems,
            undo_last_reverted_at: nowIso,
            undo_last_reverted_by: session.username,
            ...(fullyReverted
              ? {
                undo_reverted_at: nowIso,
                undo_reverted_by: session.username,
              }
              : {}),
          },
        },
      });
    } else {
      await tx.auditLog.update({
        where: { id: logId },
        data: {
          metadata: {
            ...metadata,
            undo_reverted_at: nowIso,
            undo_reverted_by: session.username,
          },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: auditLog.action === "BULK_DELETE_BENEFICIARY"
          ? "UNDO_BULK_DELETE_BENEFICIARY"
          : auditLog.action === "BULK_RESTORE_BENEFICIARY"
            ? "UNDO_BULK_RESTORE_BENEFICIARY"
            : auditLog.action === "BULK_RENEW_BALANCE"
              ? "UNDO_BULK_RENEW_BALANCE"
              : auditLog.action === "NORMALIZE_IMPORT_INTEGER_DISTRIBUTION"
                ? "UNDO_NORMALIZE_IMPORT_INTEGER_DISTRIBUTION"
                : "UNDO_FIX_PARENT_CARD_PATTERNS",
        metadata: {
          original_audit_log_id: logId,
          reverted_count: revertedCount,
          selective: selectiveRequested,
          requested_targets: selectiveRequested ? requestedTargets : [],
          reverted_items: revertedItemsThisCall,
        },
      },
    });

    return {
      revertedCount,
      fullyReverted: auditLog.action === "FIX_PARENT_CARD_PATTERNS"
        ? new Set([
          ...alreadyRevertedItems,
          ...revertedItemsThisCall,
        ]).size >= new Set(renewUndoSnapshot.map((item) => String(item.id ?? "").trim()).filter(Boolean)).size
        : true,
    };
  });

  return NextResponse.json({ success: true, revertedCount: result.revertedCount, fullyReverted: result.fullyReverted });
}
