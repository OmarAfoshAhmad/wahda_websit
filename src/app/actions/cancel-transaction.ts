"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { deleteCancellationTransaction } from "@/app/actions/restore-transaction";
import { roundCurrency } from "@/lib/money";

import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

type BulkActionResult = {
  success?: boolean;
  details?: Record<string, unknown> | null;
};

export async function cancelTransaction(transactionId: string) {
  try {
    const session = await requireActiveFacilitySession();
    if (!session || !hasPermission(session, 'cancel_transactions')) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    let createdCancellationId = "";
    let details: {
      transaction_id: string;
      cancellation_transaction_id: string;
      beneficiary_name: string;
      card_number: string;
      amount: number;
      balance_before: number;
      balance_after: number;
    } | null = null;

    await prisma.$transaction(async (tx) => {
      // FIX: قراءة الحركة داخل الـ transaction لإغلاق ثغرة TOCTOU
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: { beneficiary: true },
      });

      if (!transaction) {
        throw new Error("TX_NOT_FOUND");
      }

      if (transaction.is_cancelled) {
        throw new Error("TX_ALREADY_CANCELLED");
      }

      if (transaction.type === "CANCELLATION") {
        throw new Error("TX_IS_CANCELLATION");
      }

      const amount = Number(transaction.amount);

      // 1. قفل صف المستفيد لمنع race condition
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string }>>`
        SELECT id, remaining_balance, status FROM "Beneficiary"
        WHERE id = ${transaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const currentBalance = Number(locked[0].remaining_balance);
      const lockedStatus = locked[0].status;
      const newBalance = roundCurrency(currentBalance + amount);
      // FIX: احترام حالة الإيقاف — لا نغير SUSPENDED إلى ACTIVE
      const newStatus = lockedStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";

      // 2. Mark original transaction as cancelled
      await tx.transaction.update({
        where: { id: transactionId },
        data: { is_cancelled: true },
      });

      // 3. Update beneficiary balance with locked value
      await tx.beneficiary.update({
        where: { id: transaction.beneficiary_id },
        data: {
          remaining_balance: newBalance,
          status: newStatus,
        },
      });

      // 4. Create cancellation transaction
      const cancellationTx = await tx.transaction.create({
        data: {
          beneficiary_id: transaction.beneficiary_id,
          facility_id: session.id,
          amount: -amount,
          type: "CANCELLATION",
          is_cancelled: false,
          original_transaction_id: transactionId,
        },
      });
      createdCancellationId = cancellationTx.id;

      // 5. Audit Log — مع تسجيل الرصيد قبل وبعد
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "CANCEL_TRANSACTION",
          metadata: {
            original_transaction_id: transactionId,
            beneficiary_name: transaction.beneficiary.name,
            refunded_amount: amount,
            balance_before: currentBalance,
            balance_after: newBalance,
            card_number: transaction.beneficiary.card_number,
          },
        },
      });

      details = {
        transaction_id: transactionId,
        cancellation_transaction_id: cancellationTx.id,
        beneficiary_name: String(transaction.beneficiary.name),
        card_number: String(transaction.beneficiary.card_number),
        amount,
        balance_before: currentBalance,
        balance_after: newBalance,
      };
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");

    return { success: true, cancellationId: createdCancellationId, details };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "TX_NOT_FOUND") return { error: "المعاملة غير موجودة" };
    if (msg === "TX_ALREADY_CANCELLED") return { error: "المعاملة ملغاة بالفعل" };
    if (msg === "TX_IS_CANCELLATION") return { error: "لا يمكن إلغاء معاملة إلغاء" };
    logger.error("Cancellation error", { error: String(error) });
    return { error: "فشل في إلغاء المعاملة" };
  }
}


export async function bulkTransactionSelectionAction(formData: FormData): Promise<void> {
  const session = await requireActiveFacilitySession();
  if (!session) return;

  const op = String(formData.get("op") ?? "cancel_or_rededuct");

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return;
  }

  try {
    const selected = await prisma.transaction.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        amount: true,
        type: true,
        is_cancelled: true,
        original_transaction_id: true,
        beneficiary: { select: { name: true, card_number: true } },
        corrections: {
          where: { type: "CANCELLATION", is_cancelled: false },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (selected.length === 0) return;

    // التمييز بين عمليات الحذف (Soft/Permanent) وبين عمليات الإلغاء القياسية
    const isDeleteOp = ["soft_delete", "restore_delete", "permanent_delete"].includes(op);
    const requiredPermission = isDeleteOp ? "delete_transaction" : "cancel_transactions";

    if (!hasPermission(session, requiredPermission)) {
      return;
    }

    if (op === "soft_delete") {
      const deletable = selected.filter((tx) => {
        if (tx.is_cancelled) return false;
        // يمنع حذف أي حركة مصححة نهائياً.
        return tx.type !== "CANCELLATION";
      });
      if (deletable.length === 0) return;

      const deletableIds = deletable.map((tx) => tx.id);

      await prisma.$transaction(async (tx) => {
        for (const transactionId of deletableIds) {
          const transactionRecord = await tx.transaction.findUnique({
            where: { id: transactionId },
          });
          if (!transactionRecord) continue;

          if (transactionRecord.type === "CANCELLATION") continue;

          // تحديث الحركة كأنه محذوف ناعم
          await tx.transaction.update({
            where: { id: transactionId },
            data: { is_cancelled: true },
          });

          // جلب المستفيد مع قفل لمنع التعديل المتزامن
          const lockedBen = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string; completed_via: string | null }>>`
            SELECT id, name, card_number, remaining_balance, status, completed_via FROM "Beneficiary"
            WHERE id = ${transactionRecord.beneficiary_id}
            FOR UPDATE
          `;
          if (lockedBen.length === 0) continue;

          const beneficiary = lockedBen[0];
          const remainingBefore = Number(beneficiary.remaining_balance);
          const refundedAmount = Number(transactionRecord.amount);
          const remainingAfter = roundCurrency(remainingBefore + refundedAmount);

          // تحديث الرصيد الجديد للمستفيد بناءً على الرصيد القديم
          const nextStatus = beneficiary.status === "SUSPENDED" ? "SUSPENDED" : remainingAfter <= 0 ? "FINISHED" : "ACTIVE";
          await tx.beneficiary.update({
            where: { id: beneficiary.id },
            data: {
              remaining_balance: remainingAfter,
              status: nextStatus,
              completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "MANUAL") : null,
            },
          });

          // تسجيل في سجل المراقبة لتوضيح رد المبلغ بالضبط
          await tx.auditLog.create({
            data: {
              facility_id: session.id,
              user: session.username,
              action: "SOFT_DELETE_TRANSACTION",
              metadata: {
                transaction_id: transactionId,
                beneficiary_name: beneficiary.name,
                card_number: beneficiary.card_number,
                refunded_amount: refundedAmount,
                balance_impact: refundedAmount,
                balance_before: remainingBefore,
                balance_after: remainingAfter,
                message: `تم إلغاء الخصم/حذف الحركة وإرجاع المبلغ (${refundedAmount}) للرصيد المتبقي.`,
              },
            },
          });
        }
      });

      revalidatePath("/transactions");
      revalidatePath("/beneficiaries");
      revalidateTag("beneficiary-counts", "max");
      return;
    }

    if (op === "restore_delete") {
      // لا نستعيد حركات CANCELLATION هنا؛ هذه لها مسار مستقل (إعادة الخصم من الإلغاء)
      const restorable = selected.filter((tx) => tx.is_cancelled && tx.corrections.length === 0 && tx.type !== "CANCELLATION");
      if (restorable.length === 0) return;

      const restorableIds = restorable.map((tx) => tx.id);

      await prisma.$transaction(async (tx) => {
        for (const transactionId of restorableIds) {
          const transactionRecord = await tx.transaction.findUnique({
            where: { id: transactionId },
          });
          if (!transactionRecord) continue;

          // جلب المستفيد مع قفل لمنع التعديل المتزامن
          const lockedBen = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string; completed_via: string | null }>>`
            SELECT id, name, card_number, remaining_balance, status, completed_via FROM "Beneficiary"
            WHERE id = ${transactionRecord.beneficiary_id}
            FOR UPDATE
          `;
          if (lockedBen.length === 0) continue;

          const beneficiary = lockedBen[0];
          const remainingBefore = Number(beneficiary.remaining_balance);
          // إعادة الخصم الفعلية يجب أن تكون بقيمة موجبة دائماً
          const deductedAmount = Math.abs(Number(transactionRecord.amount));
          const remainingAfter = roundCurrency(remainingBefore - deductedAmount);

          // استرجاع الحركة المحذوفة وإعادتها منشطة
          await tx.transaction.update({
            where: { id: transactionId },
            data: { is_cancelled: false },
          });

          const nextStatus = beneficiary.status === "SUSPENDED" ? "SUSPENDED" : remainingAfter <= 0 ? "FINISHED" : "ACTIVE";
          await tx.beneficiary.update({
            where: { id: beneficiary.id },
            data: {
              remaining_balance: remainingAfter,
              status: nextStatus,
              completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "MANUAL") : null,
            },
          });

          // تسجيل التفاصيل للعمية العكسية (الاسترجاع وخصم الرصيد مرة أخرى)
          await tx.auditLog.create({
            data: {
              facility_id: session.id,
              user: session.username,
              action: "RESTORE_SOFT_DELETED_TRANSACTION",
              metadata: {
                transaction_id: transactionId,
                beneficiary_name: beneficiary.name,
                card_number: beneficiary.card_number,
                deducted_amount: deductedAmount,
                balance_before: remainingBefore,
                balance_after: remainingAfter,
                re_deduct_applied: true,
                message: `تم استرجاع الحركة المحذوفة وخصم المبلغ (${deductedAmount}) من الرصيد المتبقي مرة أخرى.`,
              },
            },
          });
        }
      });

      revalidatePath("/transactions");
      revalidatePath("/beneficiaries");
      revalidateTag("beneficiary-counts", "max");
      return;
    }

    if (op === "permanent_delete") {
      // يسمح بالحذف النهائي للحركات الملغاة + حذف زوج (التصحيح + الأصل) عند تحديد حركة تصحيح
      const selectedCancellationIds = selected
        .filter((tx) => tx.type === "CANCELLATION")
        .map((tx) => tx.id);
      const pairedOriginalIds = selected
        .filter((tx) => tx.type === "CANCELLATION" && tx.original_transaction_id)
        .map((tx) => String(tx.original_transaction_id));
      const selectedCancelledOriginalIds = selected
        .filter((tx) => tx.is_cancelled && tx.type !== "CANCELLATION")
        .map((tx) => tx.id);

      const candidateIds = [...new Set([...selectedCancellationIds, ...pairedOriginalIds, ...selectedCancelledOriginalIds])];
      if (candidateIds.length === 0) return;

      await prisma.$transaction(async (tx) => {
        // SEC-FIX: إعادة الفحص داخل الـ transaction مع قفل FOR UPDATE لمنع TOCTOU
        const lockedTransactions = await tx.$queryRaw<Array<{
          id: string; beneficiary_id: string; amount: number; type: string;
          is_cancelled: boolean; created_at: Date; facility_id: string;
        }>>`
          SELECT id, beneficiary_id, amount::float8 AS amount, type, is_cancelled, created_at, facility_id
          FROM "Transaction"
          WHERE id = ANY(${candidateIds}::text[])
          FOR UPDATE
        `;

        const pairedOriginalSet = new Set(pairedOriginalIds);
        const validOriginals = lockedTransactions.filter(
          (t) => t.type !== "CANCELLATION" && (t.is_cancelled || pairedOriginalSet.has(t.id))
        );
        const validCancellations = lockedTransactions.filter((t) => t.type === "CANCELLATION");

        if (validOriginals.length === 0 && validCancellations.length === 0) return;

        const validOriginalIds = validOriginals.map((t) => t.id);
        const validCancellationIds = validCancellations.map((t) => t.id);

        // SEC-FIX: حفظ snapshot كامل للحركات المحذوفة في سجل التدقيق للمرجعية
        const deletedSnapshot = [...validOriginals, ...validCancellations].map((t) => ({
          id: t.id,
          beneficiary_id: t.beneficiary_id,
          amount: t.amount,
          type: t.type,
          created_at: t.created_at,
          facility_id: t.facility_id,
        }));

        // حركات الإلغاء المرتبطة
        await tx.transaction.deleteMany({
          where: {
            OR: [
              { id: { in: validCancellationIds } },
              { original_transaction_id: { in: validOriginalIds } },
            ],
          },
        });

        // الحركات نفسها
        await tx.transaction.deleteMany({
          where: { id: { in: validOriginalIds } },
        });

        // إعادة احتساب الرصيد والحالة لكل مستفيد متأثر بعد الحذف النهائي
        const affectedBeneficiaryIds = [...new Set([...validOriginals, ...validCancellations].map((t) => t.beneficiary_id))];
        const balanceChanges: Array<{ beneficiary_id: string; beneficiary_name: string; card_number: string; balance_before: number; balance_after: number; status_after: string }> = [];

        for (const beneficiaryId of affectedBeneficiaryIds) {
          const lockedBen = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }>>`
            SELECT id, name, card_number, remaining_balance, status FROM "Beneficiary"
            WHERE id = ${beneficiaryId}
            FOR UPDATE
          `;
          if (lockedBen.length === 0) continue;

          const beneficiaryMeta = await tx.beneficiary.findUnique({
            where: { id: beneficiaryId },
            select: { total_balance: true, completed_via: true },
          });
          if (!beneficiaryMeta) continue;

          const agg = await tx.transaction.aggregate({
            where: {
              beneficiary_id: beneficiaryId,
              is_cancelled: false,
              type: { not: "CANCELLATION" },
            },
            _sum: { amount: true },
          });

          const totalBalance = Number(beneficiaryMeta.total_balance);
          const totalSpent = Number(agg._sum.amount ?? 0);
          const newBalance = roundCurrency(Math.max(0, totalBalance - totalSpent));
          const lockedStatus = lockedBen[0].status;
          const newStatus = lockedStatus === "SUSPENDED" ? "SUSPENDED" : (newBalance <= 0 ? "FINISHED" : "ACTIVE");

          const beneficiaryUpdateData: {
            remaining_balance: number;
            status: "ACTIVE" | "FINISHED" | "SUSPENDED";
            completed_via?: "MANUAL" | "IMPORT" | null;
          } = {
            remaining_balance: newBalance,
            status: newStatus,
          };

          if (newStatus === "FINISHED") {
            beneficiaryUpdateData.completed_via = (beneficiaryMeta.completed_via as "MANUAL" | "IMPORT" | null) ?? "MANUAL";
          } else if (newStatus !== "SUSPENDED") {
            beneficiaryUpdateData.completed_via = null;
          }

          await tx.beneficiary.update({
            where: { id: beneficiaryId },
            data: beneficiaryUpdateData,
          });

          balanceChanges.push({
            beneficiary_id: beneficiaryId,
            beneficiary_name: lockedBen[0].name,
            card_number: lockedBen[0].card_number,
            balance_before: Number(lockedBen[0].remaining_balance),
            balance_after: newBalance,
            status_after: newStatus,
          });
        }

        // تسجيل في سجل المراقبة
        await tx.auditLog.create({
          data: {
            facility_id: session.id,
            user: session.username,
            action: "PERMANENT_DELETE_TRANSACTION",
            metadata: {
              selected_count: ids.length,
              deleted_count: validOriginals.length + validCancellations.length,
              transaction_ids: [...validOriginalIds, ...validCancellationIds],
              balance_recalculated: true,
              balance_changes: balanceChanges,
              deleted_snapshot: deletedSnapshot,
              message: "تم حذف الحركات/أزواج الإلغاء نهائياً من قاعدة البيانات.",
            },
          },
        });
      });

      revalidatePath("/transactions");
      revalidatePath("/beneficiaries");
      revalidateTag("beneficiary-counts", "max");
      return;
    }

    const actionable = selected.filter((tx) => !tx.is_cancelled);
    if (actionable.length === 0) return;

    const hasCancellation = actionable.some((tx) => tx.type === "CANCELLATION");
    const hasNormal = actionable.some((tx) => tx.type !== "CANCELLATION");

    // لا ننفذ على خليط من النوعين ضمن نفس الطلب لتفادي عمليات متعاكسة.
    if (hasCancellation && hasNormal) {
      return;
    }

    let successCount = 0;
    let skippedCount = 0;
    const detailedItems: Array<Record<string, unknown>> = [];

    if (hasCancellation) {
      for (const tx of actionable) {
        const result = (await deleteCancellationTransaction(tx.id)) as BulkActionResult;
        if (result.success) {
          successCount += 1;
          if (result.details) {
            detailedItems.push(result.details);
          }
        } else skippedCount += 1;
      }

      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_REDEDUCT_TRANSACTION",
          metadata: {
            selected_count: ids.length,
            processed_count: actionable.length,
            rededucted_count: successCount,
            skipped_count: skippedCount,
            transaction_ids: actionable.map((item) => item.id),
            items: detailedItems,
          },
        },
      });
    } else {
      for (const tx of actionable) {
        const result = (await cancelTransaction(tx.id)) as BulkActionResult;
        if (result.success) {
          successCount += 1;
          if (result.details) {
            detailedItems.push(result.details);
          }
        } else skippedCount += 1;
      }

      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_CANCEL_TRANSACTION",
          metadata: {
            selected_count: ids.length,
            processed_count: actionable.length,
            cancelled_count: successCount,
            skipped_count: skippedCount,
            transaction_ids: actionable.map((item) => item.id),
            items: detailedItems,
          },
        },
      });
    }

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
  } catch (error) {
    logger.error("Bulk mixed transaction action error", { error: String(error) });
  }
}
