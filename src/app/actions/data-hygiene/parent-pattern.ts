"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { Prisma, TransactionType } from "@prisma/client";
import { extractBaseCard, normalizePersonName } from "@/lib/normalize";
import { 
  ParentCardPatternFixMode, 
  ParentCardPatternFixResult, 
  BackgroundActor 
} from "./types";

export async function normalizeParentCardByMode(cardNumber: string, mode: ParentCardPatternFixMode) {
  const card = String(cardNumber ?? "").trim().toUpperCase();
  const match = card.match(/^(WAB2025\d+)([A-Z])(\d+)?$/);
  if (!match) {
    return { changed: false, nextCard: card, reason: "not_supported" as const };
  }

  const [, base, code, numRaw] = match;
  const num = numRaw ? Number(numRaw) : null;

  if (code === "H") {
    if (num === 2) {
      return { changed: true, nextCard: `${base}H1`, reason: "h2_to_h1" as const };
    }
    if (num === null && mode === "all_to_numbered") {
      return { changed: true, nextCard: `${base}H1`, reason: "plain_to_numbered" as const };
    }
    return { changed: false, nextCard: card, reason: "h_valid" as const };
  }

  if (code !== "M" && code !== "F" && code !== "W") {
    return { changed: false, nextCard: card, reason: "not_parent_suffix" as const };
  }

  if (mode === "h2_to_h1_only") {
    return { changed: false, nextCard: card, reason: "mode_skip" as const };
  }

  if (mode === "all_to_numbered") {
    if (numRaw === undefined) {
      return { changed: true, nextCard: `${base}${code}1`, reason: "plain_to_numbered" as const };
    }
    return { changed: false, nextCard: card, reason: "already_numbered" as const };
  }

  if (num === 1) {
    return { changed: true, nextCard: `${base}${code}`, reason: "numbered_to_plain" as const };
  }

  return { changed: false, nextCard: card, reason: "plain_or_other_number" as const };
}

export async function runParentCardPatternFixAction(request: {
  mode?: ParentCardPatternFixMode;
  onProgress?: (progress: {
    total: number;
    examined: number;
    processed: number;
    skipped: number;
    conflicts: number;
    h2Fixed: number;
    normalized: number;
  }) => void;
} = {}, actor?: BackgroundActor): Promise<ParentCardPatternFixResult> {
  const session = actor
    ? { id: actor.id, username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
    
  if (!session?.is_admin) {
    return {
      success: false,
      mode: request.mode ?? "all_to_numbered",
      processed_count: 0,
      merged_count: 0,
      skipped_count: 0,
      conflict_count: 0,
      h2_fixed_count: 0,
      parent_suffix_normalized_count: 0,
      error: "غير مصرح",
    };
  }

  const mode = request.mode ?? "all_to_numbered";

  try {
    const candidates = await prisma.$queryRaw<Array<{ id: string; name: string; card_number: string }>>`
      SELECT b.id, b.name, b.card_number
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL
        AND (
          b.card_number ~ '^WAB2025[0-9]+W$'
          OR b.card_number ~ '^WAB2025[0-9]+W1$'
          OR b.card_number ~ '^WAB2025[0-9]+M$'
          OR b.card_number ~ '^WAB2025[0-9]+M1$'
          OR b.card_number ~ '^WAB2025[0-9]+F$'
          OR b.card_number ~ '^WAB2025[0-9]+F1$'
          OR b.card_number ~ '^WAB2025[0-9]+H$'
          OR b.card_number ~ '^WAB2025[0-9]+H2$'
        )
      ORDER BY b.card_number ASC
      LIMIT 10000
    `;

    const details: Array<Record<string, unknown>> = [];
    let processed = 0;
    let merged = 0;
    let skipped = 0;
    let conflicts = 0;
    let h2Fixed = 0;
    let parentNormalized = 0;
    let examined = 0;
    const undoSnapshot: Array<Record<string, unknown>> = [];

    request.onProgress?.({
      total: candidates.length,
      examined,
      processed,
      skipped,
      conflicts,
      h2Fixed,
      normalized: parentNormalized,
    });

    for (const row of candidates) {
      examined += 1;
      const normalized = await normalizeParentCardByMode(row.card_number, mode);
      if (!normalized.changed || normalized.nextCard === row.card_number) {
        if (examined % 25 === 0 || examined === candidates.length) {
          request.onProgress?.({
            total: candidates.length,
            examined,
            processed,
            skipped,
            conflicts,
            h2Fixed,
            normalized: parentNormalized,
          });
        }
        continue;
      }

      const conflict = await prisma.beneficiary.findFirst({
        where: {
          deleted_at: null,
          card_number: normalized.nextCard,
          id: { not: row.id },
        },
        select: {
          id: true,
          name: true,
          card_number: true,
          total_balance: true,
          remaining_balance: true,
          status: true,
          completed_via: true,
        },
      });

      if (conflict) {
        const samePersonByNameAndBaseCard =
          normalizePersonName(conflict.name) === normalizePersonName(row.name) &&
          extractBaseCard(conflict.card_number) === extractBaseCard(row.card_number);

        if (samePersonByNameAndBaseCard) {
          const mergeResult = await prisma.$transaction(async (tx) => {
            const source = await tx.beneficiary.findUnique({
              where: { id: row.id },
              select: {
                id: true,
                name: true,
                card_number: true,
                total_balance: true,
                remaining_balance: true,
                status: true,
                completed_via: true,
                deleted_at: true,
              },
            });

            const target = await tx.beneficiary.findUnique({
              where: { id: conflict.id },
              select: {
                id: true,
                name: true,
                card_number: true,
                total_balance: true,
                remaining_balance: true,
                status: true,
                completed_via: true,
                deleted_at: true,
              },
            });

            if (!source || !target || source.deleted_at || target.deleted_at) {
              return { merged: false, movedTransactions: 0, movedNotifications: 0, reason: "missing_or_deleted" };
            }

            const keepId = target.id;
            const mergeId = source.id;
            const keepCardNumber = target.card_number;
            const keepCompletedVia = target.completed_via ?? source.completed_via;

            const sourceActiveImports = await tx.transaction.findMany({
              where: {
                beneficiary_id: mergeId,
                type: TransactionType.IMPORT,
                is_cancelled: false,
              },
              orderBy: { created_at: "asc" },
              select: { id: true },
            });

            const targetHasActiveImport = await tx.transaction.findFirst({
              where: {
                beneficiary_id: keepId,
                type: TransactionType.IMPORT,
                is_cancelled: false,
              },
              select: { id: true },
            });

            const importIdsToCancel: string[] = [];

            if (sourceActiveImports.length > 1) {
              importIdsToCancel.push(...sourceActiveImports.slice(1).map((row) => row.id));
            }

            if (targetHasActiveImport && sourceActiveImports.length > 0) {
              const sourcePrimaryImportId = sourceActiveImports[0]?.id;
              if (sourcePrimaryImportId && !importIdsToCancel.includes(sourcePrimaryImportId)) {
                importIdsToCancel.push(sourcePrimaryImportId);
              }
            }

            const cancelledSourceImports = importIdsToCancel.length > 0
              ? (await tx.transaction.updateMany({
                  where: { id: { in: importIdsToCancel } },
                  data: { is_cancelled: true },
                })).count
              : 0;

            const movedTransactions = await tx.transaction.updateMany({
              where: { beneficiary_id: mergeId },
              data: { beneficiary_id: keepId },
            });

            const movedNotifications = await tx.notification.updateMany({
              where: { beneficiary_id: mergeId },
              data: { beneficiary_id: keepId },
            });

            const activeTransactions = await tx.transaction.aggregate({
              where: {
                beneficiary_id: keepId,
                is_cancelled: false,
                type: { not: "CANCELLATION" },
              },
              _sum: { amount: true },
            });

            const mergedTotal = Math.max(Number(source.total_balance) || 0, Number(target.total_balance) || 0);
            const spent = Number(activeTransactions._sum.amount ?? 0);
            const remaining = Math.max(0, mergedTotal - spent);
            const nextStatus =
              source.status === "SUSPENDED" || target.status === "SUSPENDED"
                ? "SUSPENDED"
                : (remaining <= 0 ? "FINISHED" : "ACTIVE");

            await tx.beneficiary.update({
              where: { id: keepId },
              data: {
                card_number: keepCardNumber,
                total_balance: mergedTotal,
                remaining_balance: remaining,
                status: nextStatus,
                completed_via: nextStatus === "FINISHED"
                  ? (keepCompletedVia ?? "IMPORT")
                  : null,
              },
            });

            await tx.beneficiary.update({
              where: { id: mergeId },
              data: { deleted_at: new Date() },
            });

            return {
              merged: true,
              keepBeneficiaryId: keepId,
              movedTransactions: movedTransactions.count,
              movedNotifications: movedNotifications.count,
              cancelledSourceImports,
              reason: "kept_numbered_target",
            };
          });

          if (mergeResult.merged) {
            processed += 1;
            merged += 1;
            details.push({
              beneficiary_id: row.id,
              beneficiary_name: row.name,
              old_card_number: row.card_number,
              new_card_number: conflict.card_number,
              result: "merged_to_numbered",
              reason: "name_and_base_card_match",
              merged_into_beneficiary_id: mergeResult.keepBeneficiaryId,
              moved_transactions: mergeResult.movedTransactions,
              moved_notifications: mergeResult.movedNotifications,
              cancelled_source_imports: mergeResult.cancelledSourceImports,
              merge_strategy: mergeResult.reason,
            });
            if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
              request.onProgress?.({
                total: candidates.length,
                examined,
                processed,
                skipped,
                conflicts,
                h2Fixed,
                normalized: parentNormalized,
              });
            }
            continue;
          }

          skipped += 1;
          conflicts += 1;
          details.push({
            beneficiary_id: row.id,
            beneficiary_name: row.name,
            old_card_number: row.card_number,
            new_card_number: normalized.nextCard,
            result: "skipped_conflict_merge_blocked",
            conflict_with: conflict.id,
            reason: mergeResult.reason,
          });
          if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
            request.onProgress?.({
              total: candidates.length,
              examined,
              processed,
              skipped,
              conflicts,
              h2Fixed,
              normalized: parentNormalized,
            });
          }
          continue;
        }

        skipped += 1;
        conflicts += 1;
        details.push({
          beneficiary_id: row.id,
          beneficiary_name: row.name,
          old_card_number: row.card_number,
          new_card_number: normalized.nextCard,
          result: "skipped_conflict",
          conflict_with: conflict.id,
          reason: normalized.reason,
        });
        if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
          request.onProgress?.({
            total: candidates.length,
            examined,
            processed,
            skipped,
            conflicts,
            h2Fixed,
            normalized: parentNormalized,
          });
        }
        continue;
      }

      try {
        await prisma.beneficiary.update({
          where: { id: row.id },
          data: { card_number: normalized.nextCard },
        });
      } catch (updateError) {
        if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === "P2002") {
          skipped += 1;
          conflicts += 1;
          details.push({
            beneficiary_id: row.id,
            beneficiary_name: row.name,
            old_card_number: row.card_number,
            new_card_number: normalized.nextCard,
            result: "skipped_conflict_runtime",
            reason: "unique_constraint",
          });
          if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
            request.onProgress?.({
              total: candidates.length,
              examined,
              processed,
              skipped,
              conflicts,
              h2Fixed,
              normalized: parentNormalized,
            });
          }
          continue;
        }
        throw updateError;
      }

      processed += 1;
      undoSnapshot.push({
        id: row.id,
        old_card_number: row.card_number,
        new_card_number: normalized.nextCard,
      });
      if (normalized.reason === "h2_to_h1") {
        h2Fixed += 1;
      } else {
        parentNormalized += 1;
      }

      details.push({
        beneficiary_id: row.id,
        beneficiary_name: row.name,
        old_card_number: row.card_number,
        new_card_number: normalized.nextCard,
        result: "updated",
        reason: normalized.reason,
      });

      if ((processed + skipped) % 25 === 0 || (processed + skipped) === candidates.length) {
        request.onProgress?.({
          total: candidates.length,
          examined,
          processed,
          skipped,
          conflicts,
          h2Fixed,
          normalized: parentNormalized,
        });
      }
    }

    request.onProgress?.({
      total: candidates.length,
      examined,
      processed,
      skipped,
      conflicts,
      h2Fixed,
      normalized: parentNormalized,
    });

    const detailsLimit = 500;
    const detailsForAudit = details.length > detailsLimit ? details.slice(0, detailsLimit) : details;

    await prisma.auditLog.create({
      data: {
        user: session.username,
        action: AUDIT_ACTIONS.FIX_PARENT_CARD_PATTERNS,
        metadata: {
          mode,
          processed_count: processed,
          merged_count: merged,
          skipped_count: skipped,
          conflict_count: conflicts,
          h2_fixed_count: h2Fixed,
          parent_suffix_normalized_count: parentNormalized,
          candidates_count: candidates.length,
          details_count: details.length,
          details_truncated: details.length > detailsLimit,
          details: detailsForAudit,
          undo_snapshot: undoSnapshot,
        },
      },
    });

    if (!actor) {
      revalidatePath("/admin/db-anomalies");
      revalidatePath("/admin/balance-health");
      revalidatePath("/admin/duplicates");
      revalidatePath("/admin/audit-log");
    }

    return {
      success: true,
      mode,
      processed_count: processed,
      merged_count: merged,
      skipped_count: skipped,
      conflict_count: conflicts,
      h2_fixed_count: h2Fixed,
      parent_suffix_normalized_count: parentNormalized,
    };
  } catch (error) {
    console.error("[runParentCardPatternFixAction]", error);
    const detailedError = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      mode,
      processed_count: 0,
      merged_count: 0,
      skipped_count: 0,
      conflict_count: 0,
      h2_fixed_count: 0,
      parent_suffix_normalized_count: 0,
      error: `تعذّر تنفيذ تحويل نمط البطاقات: ${detailedError}`,
    };
  }
}
