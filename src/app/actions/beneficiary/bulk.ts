"use server";

import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { canonicalizeCardNumber } from "@/lib/normalize";
import * as utils from "./utils";

export async function bulkUpdateLegacyCardMarker(data: {
  pattern: string;
  setLegacy: boolean;
}) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "edit_beneficiary")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const pattern = String(data.pattern ?? "").trim();
  if (!pattern || pattern.length < 2 || pattern.length > 32) {
    return { error: "نمط البطاقة غير صالح" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updateRes = await tx.beneficiary.updateMany({
        where: {
          deleted_at: null,
          card_number: { contains: pattern, mode: "insensitive" },
          is_legacy_card: { not: data.setLegacy },
        },
        data: { is_legacy_card: data.setLegacy },
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_SET_LEGACY_CARD_FLAG",
          metadata: {
            pattern,
            set_legacy: data.setLegacy,
            updated_count: updateRes.count,
          },
        },
      });

      return updateRes;
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    revalidatePath("/admin/audit-log");
    return { success: true, updatedCount: result.count };
  } catch (error: unknown) {
    logger.error("Bulk update legacy card marker error", { error: String(error), pattern, setLegacy: data.setLegacy });
    return { error: "تعذر تحديث حالة البطاقات" };
  }
}

export async function setSingleLegacyCardMarker(data: {
  id: string;
  setLegacy: boolean;
}) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "edit_beneficiary")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const id = String(data.id ?? "").trim();
  if (!id) {
    return { error: "معرف المستفيد غير صالح" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.beneficiary.findFirst({
        where: { id, deleted_at: null },
        select: {
          id: true,
          name: true,
          card_number: true,
          is_legacy_card: true,
        },
      });

      if (!existing) {
        throw new Error("NOT_FOUND");
      }

      if (existing.is_legacy_card === data.setLegacy) {
        return { updated: false, existing };
      }

      await tx.beneficiary.update({
        where: { id: existing.id },
        data: { is_legacy_card: data.setLegacy },
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "SET_LEGACY_CARD_FLAG",
          metadata: {
            beneficiary_id: existing.id,
            beneficiary_name: existing.name,
            card_number: existing.card_number,
            old_is_legacy_card: existing.is_legacy_card,
            new_is_legacy_card: data.setLegacy,
          },
        },
      });

      return { updated: true, existing };
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    revalidatePath("/admin/duplicates");
    revalidatePath("/admin/audit-log");

    return { success: true, updated: result.updated };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return { error: "المستفيد غير موجود" };
    }
    logger.error("Set single legacy card marker error", { error: String(error), id, setLegacy: data.setLegacy });
    return { error: "تعذر تحديث حالة البطاقة" };
  }
}

export async function stabilizeLegacyCardsWithBatch() {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "edit_beneficiary")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{
        id: string;
        name: string;
        card_number: string;
        batch_number: string;
        city: string;
      }>>`
        SELECT DISTINCT
          b.id,
          b.name,
          b.card_number,
          r.batch_number,
          r.city
        FROM "Beneficiary" b
        INNER JOIN "CardIssuanceRegistry" r
          ON UPPER(BTRIM(b.card_number)) = r.card_number_upper
        WHERE b.deleted_at IS NULL
          AND b.is_legacy_card = true
          AND r.batch_number IS NOT NULL
          AND BTRIM(r.batch_number) <> ''
      `;

      const candidateIds = [...new Set(candidates.map((c) => c.id).filter(Boolean))];
      const updateRes = candidateIds.length > 0
        ? await tx.beneficiary.updateMany({
            where: { id: { in: candidateIds }, deleted_at: null, is_legacy_card: true },
            data: { is_legacy_card: false },
          })
        : { count: 0 };

      const candidateCount = candidateIds.length;
      const updatedCount = Number(updateRes.count ?? 0);
      const details = candidates.map((row) => ({
        beneficiary_id: row.id,
        beneficiary_name: row.name,
        card_number: row.card_number,
        batch_number: row.batch_number,
        city: row.city,
        old_is_legacy_card: true,
        new_is_legacy_card: false,
        result: "stabilized",
      }));
      const undoSnapshot = candidateIds.map((id) => ({
        id,
        old_is_legacy_card: true,
        new_is_legacy_card: false,
      }));

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_STABILIZE_LEGACY_WITH_BATCH",
          metadata: {
            selected_count: candidateCount,
            processed_count: updatedCount,
            candidate_count: candidateCount,
            updated_count: updatedCount,
            details,
            undo_snapshot: undoSnapshot,
          },
        },
      });

      return { candidateCount, updatedCount };
    });

    // revalidatePath and revalidateTag are not safe for background tasks.
    // The UI handles refresh when the job is done.
    return { success: true, ...result };
  } catch (error: unknown) {
    logger.error("Stabilize legacy cards with batch error", { error: String(error) });
    return { error: "تعذر معالجة البطاقات القديمة ذات رقم الدفعة" };
  }
}

export async function bulkDeleteBeneficiaries(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "delete_beneficiary")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        card_number: true,
        deleted_at: true,
        _count: { select: { transactions: true } },
      },
    });

    const deletableIds = beneficiaries
      .filter((b) => b.deleted_at === null && b._count.transactions === 0)
      .map((b) => b.id);

    const skippedCount = beneficiaries.length - deletableIds.length;

    if (deletableIds.length === 0) {
      return { error: "لا توجد سجلات قابلة للحذف ضمن المحدد" };
    }

    const deletedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.beneficiary.updateMany({
        where: { id: { in: deletableIds } },
        data: { deleted_at: deletedAt },
      });

      const details = beneficiaries.map((b) => {
        const canDelete = b.deleted_at === null && b._count.transactions === 0;
        return {
          beneficiary_id: b.id,
          beneficiary_name: b.name,
          card_number: b.card_number,
          transactions_count: b._count.transactions,
          before_deleted_at: b.deleted_at ? b.deleted_at.toISOString() : null,
          after_deleted_at: canDelete ? deletedAt.toISOString() : (b.deleted_at ? b.deleted_at.toISOString() : null),
          result: canDelete ? "deleted" : "skipped",
        };
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_DELETE_BENEFICIARY",
          metadata: {
            selected_count: ids.length,
            deleted_count: deletableIds.length,
            skipped_count: skippedCount,
            beneficiary_ids: deletableIds,
            details,
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, deletedCount: deletableIds.length, skippedCount };
  } catch (error: unknown) {
    logger.error("Bulk delete beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ الحذف الجماعي" };
  }
}

export async function bulkPermanentDeleteBeneficiaries(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_recycle_bin")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        card_number: true,
        deleted_at: true,
        _count: { select: { transactions: true } },
      },
    });

    const deletableIds = beneficiaries
      .filter((b) => b.deleted_at !== null && b._count.transactions === 0)
      .map((b) => b.id);

    const skippedCount = beneficiaries.length - deletableIds.length;

    if (deletableIds.length === 0) {
      return { error: "لا توجد سجلات قابلة للحذف النهائي ضمن المحدد" };
    }

    await prisma.$transaction(async (tx) => {
      // حذف التوابع أولاً لتفادي قيود FK من نوع RESTRICT
      await tx.walletConsumption.deleteMany({ where: { beneficiary_id: { in: deletableIds } } });
      await tx.claim.deleteMany({ where: { beneficiary_id: { in: deletableIds } } });
      await tx.notification.deleteMany({ where: { beneficiary_id: { in: deletableIds } } });
      await tx.beneficiary.deleteMany({ where: { id: { in: deletableIds } } });

      const details = beneficiaries.map((b) => {
        const canDelete = b.deleted_at !== null && b._count.transactions === 0;
        return {
          beneficiary_id: b.id,
          beneficiary_name: b.name,
          card_number: b.card_number,
          transactions_count: b._count.transactions,
          before_deleted_at: b.deleted_at ? b.deleted_at.toISOString() : null,
          after_deleted_at: canDelete ? "PERMANENTLY_DELETED" : (b.deleted_at ? b.deleted_at.toISOString() : null),
          result: canDelete ? "permanently_deleted" : "skipped",
        };
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_PERMANENT_DELETE_BENEFICIARY",
          metadata: {
            selected_count: ids.length,
            deleted_count: deletableIds.length,
            skipped_count: skippedCount,
            beneficiary_ids: deletableIds,
            details,
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, deletedCount: deletableIds.length, skippedCount };
  } catch (error: unknown) {
    logger.error("Bulk permanent delete beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ الحذف النهائي الجماعي" };
  }
}

export async function bulkRestoreBeneficiaries(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "manage_recycle_bin")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, card_number: true, deleted_at: true },
    });

    const restorableIds = beneficiaries
      .filter((b) => b.deleted_at !== null)
      .map((b) => b.id);

    const skippedCount = beneficiaries.length - restorableIds.length;

    if (restorableIds.length === 0) {
      return { error: "لا توجد سجلات قابلة للاستعادة ضمن المحدد" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.beneficiary.updateMany({
        where: { id: { in: restorableIds } },
        data: { deleted_at: null },
      });

      const details = beneficiaries.map((b) => {
        const canRestore = b.deleted_at !== null;
        return {
          beneficiary_id: b.id,
          beneficiary_name: b.name,
          card_number: b.card_number,
          before_deleted_at: b.deleted_at ? b.deleted_at.toISOString() : null,
          after_deleted_at: canRestore ? null : null,
          result: canRestore ? "restored" : "skipped",
        };
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_RESTORE_BENEFICIARY",
          metadata: {
            selected_count: ids.length,
            restored_count: restorableIds.length,
            skipped_count: skippedCount,
            beneficiary_ids: restorableIds,
            details,
          },
        },
      });
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, restoredCount: restorableIds.length, skippedCount };
  } catch (error: unknown) {
    logger.error("Bulk restore beneficiaries error", { error: String(error) });
    return { error: "تعذر تنفيذ الاستعادة الجماعية" };
  }
}

export async function bulkRenewBalance(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  try {
    const initialBalance = await getCurrentInitialBalance();

    const result = await prisma.$transaction(async (tx) => {
      const beneficiaries = await tx.$queryRaw<
        Array<{ id: string; name: string; card_number: string; total_balance: number; remaining_balance: number; status: string }>
      >`
        SELECT id, name, card_number, total_balance, remaining_balance, status
        FROM "Beneficiary"
        WHERE id = ANY(${ids}::text[]) AND "deleted_at" IS NULL
        FOR UPDATE
      `;

      if (beneficiaries.length === 0) {
        throw new Error("NO_VALID_RECORDS");
      }

      const beneficiaryIds = beneficiaries.map((b) => b.id);

      const spentRows = await tx.transaction.groupBy({
        by: ["beneficiary_id"],
        where: {
          beneficiary_id: { in: beneficiaryIds },
          is_cancelled: false,
          type: { not: "CANCELLATION" },
        },
        _sum: { amount: true },
      });
      const spentById = new Map(spentRows.map((row) => [row.beneficiary_id, Number(row._sum.amount ?? 0)]));

      const renewalDetails = beneficiaries.map((b) => {
        const total = Number(b.total_balance);
        const spent = spentById.get(b.id) ?? 0;
        const ledgerRemaining = Math.max(0, total - spent);
        const total_after = total + initialBalance;
        const remaining_after = Math.min(ledgerRemaining + initialBalance, total_after);
        return {
          id: b.id,
          name: b.name,
          card_number: b.card_number,
          total_before: total,
          total_after,
          remaining_before: ledgerRemaining,
          remaining_after,
          status_before: b.status,
        };
      });

      for (const detail of renewalDetails) {
        await tx.beneficiary.update({
          where: { id: detail.id },
          data: {
            total_balance: detail.total_after,
            remaining_balance: detail.remaining_after,
            status: "ACTIVE",
            completed_via: null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_RENEW_BALANCE",
          metadata: {
            beneficiary_count: beneficiaryIds.length,
            renewal_amount: initialBalance,
            details: renewalDetails,
            undo_snapshot: renewalDetails.map((d) => ({
              id: d.id,
              total_before: d.total_before,
              remaining_before: d.remaining_before,
              status_before: d.status_before,
            })),
          },
        },
      });

      return { renewedCount: beneficiaryIds.length };
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, renewedCount: result.renewedCount };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "NO_VALID_RECORDS") {
      return { error: "لا توجد سجلات صالحة للتجديد" };
    }
    logger.error("Bulk renew balance error", { error: String(error) });
    return { error: "تعذر تنفيذ التجديد الجماعي" };
  }
}

export async function undoBulkRenewal(auditLogId: string) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  if (!auditLogId) {
    return { error: "معرف سجل التدقيق مطلوب" };
  }

  try {
    const auditLog = await prisma.auditLog.findUnique({
      where: { id: auditLogId },
      select: { id: true, action: true, metadata: true },
    });

    if (!auditLog || auditLog.action !== "BULK_RENEW_BALANCE") {
      return { error: "سجل التدقيق غير موجود أو ليس عملية تجديد" };
    }

    const metadata = auditLog.metadata as Record<string, unknown> | null;
    const undoSnapshot = metadata?.undo_snapshot as Array<{
      id: string;
      total_before: number;
      remaining_before: number;
      status_before: string;
    }> | undefined;

    if (!undoSnapshot || undoSnapshot.length === 0) {
      return { error: "لا توجد بيانات تراجع لهذه العملية" };
    }

    if (metadata?.undo_reverted_at) {
      return { error: "تم التراجع عن هذه العملية مسبقاً" };
    }

    const result = await prisma.$transaction(async (tx) => {
      const beneficiaryIds = undoSnapshot.map((s) => s.id);

      await tx.$queryRaw`
        SELECT id FROM "Beneficiary"
        WHERE id = ANY(${beneficiaryIds}::text[]) AND "deleted_at" IS NULL
        FOR UPDATE
      `;

      let revertedCount = 0;
      for (const snap of undoSnapshot) {
        await tx.beneficiary.update({
          where: { id: snap.id },
          data: {
            total_balance: snap.total_before,
            remaining_balance: snap.remaining_before,
            status: snap.status_before as "ACTIVE" | "FINISHED" | "SUSPENDED",
          },
        });
        revertedCount++;
      }

      await tx.auditLog.update({
        where: { id: auditLogId },
        data: {
          metadata: {
            ...(metadata ?? {}),
            undo_reverted_at: new Date().toISOString(),
            undo_reverted_by: session.username,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "UNDO_BULK_RENEW_BALANCE",
          metadata: {
            original_audit_log_id: auditLogId,
            reverted_count: revertedCount,
          },
        },
      });

      return { revertedCount };
    });

    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, revertedCount: result.revertedCount };
  } catch (error: unknown) {
    logger.error("Undo bulk renewal error", { error: String(error) });
    return { error: "تعذر التراجع عن التجديد الجماعي" };
  }
}

export async function bulkUpdateBeneficiaryBatch(data: {
  ids: string[];
  batchNumber: string;
}) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "edit_beneficiary")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const ids = Array.isArray(data.ids) ? data.ids.filter(Boolean) : [];
  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي مستفيد" };
  }

  const batchNumber = String(data.batchNumber ?? "").trim();
  if (!batchNumber) {
    return { error: "يرجى إدخال رقم دفعة صالح" };
  }

  try {
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { id: { in: ids }, deleted_at: null },
      select: {
        id: true,
        name: true,
        card_number: true,
        birth_date: true,
        city: true,
      },
    });

    if (beneficiaries.length === 0) {
      return { error: "لم يتم العثور على أي من المستفيدين المحددين" };
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update Beneficiary table
      const updateRes = await tx.beneficiary.updateMany({
        where: { id: { in: ids }, deleted_at: null },
        data: { batch_number: batchNumber },
      });

      // 2. Insert/Update into CardIssuanceRegistry and CardIssuanceRegistryAll
      for (const b of beneficiaries) {
        const cardUpper = b.card_number.trim().toUpperCase();
        const canonical = canonicalizeCardNumber(cardUpper);
        const finalCity = b.city || "المنظومة";

        // Upsert into CardIssuanceRegistryAll
        await tx.cardIssuanceRegistryAll.upsert({
          where: { id: `${cardUpper}-${batchNumber}` },
          update: {
            card_number: b.card_number,
            card_number_upper: cardUpper,
            beneficiary_name: b.name,
            birth_date: b.birth_date,
            city: finalCity,
            batch_number: batchNumber,
            updated_at: new Date(),
          },
          create: {
            id: `${cardUpper}-${batchNumber}`,
            card_number: b.card_number,
            card_number_upper: cardUpper,
            canonical_card: canonical,
            beneficiary_name: b.name,
            birth_date: b.birth_date,
            city: finalCity,
            batch_number: batchNumber,
          },
        });

        // Upsert into CardIssuanceRegistry
        await tx.cardIssuanceRegistry.upsert({
          where: { card_number_upper: cardUpper },
          update: {
            beneficiary_name: b.name,
            birth_date: b.birth_date,
            city: finalCity,
            batch_number: batchNumber,
            updated_at: new Date(),
          },
          create: {
            card_number: b.card_number,
            card_number_upper: cardUpper,
            canonical_card: canonical,
            beneficiary_name: b.name,
            birth_date: b.birth_date,
            city: finalCity,
            batch_number: batchNumber,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_SET_BENEFICIARY_BATCH",
          metadata: {
            ids,
            batch_number: batchNumber,
            updated_count: updateRes.count,
          },
        },
      });

      return { count: updateRes.count };
    });

    revalidatePath("/beneficiaries");
    revalidatePath("/admin/health");
    revalidateTag("beneficiary-counts", "max");
    return { success: true, updatedCount: result.count };
  } catch (error: unknown) {
    logger.error("Bulk update beneficiary batch error", { error: String(error), ids, batchNumber });
    return { error: "تعذر تحديث دفعة المستفيدين" };
  }
}
