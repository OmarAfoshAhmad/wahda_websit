"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { deleteCancellationTransaction } from "@/app/actions/restore-transaction";
import { roundCurrency } from "@/lib/money";

import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

export async function cancelTransaction(transactionId: string) {
  try {
    const session = await requireActiveFacilitySession();
    if (!session || !hasPermission(session, 'cancel_transactions')) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { beneficiary: true },
    });

    if (!transaction) {
      return { error: "المعاملة غير موجودة" };
    }

    if (transaction.is_cancelled) {
      return { error: "المعاملة ملغاة بالفعل" };
    }

    if (transaction.type === "CANCELLATION") {
      return { error: "لا يمكن إلغاء معاملة إلغاء" };
    }

    const amount = Number(transaction.amount);

    let createdCancellationId = "";

    await prisma.$transaction(async (tx) => {
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
            refunded_amount: amount,
            balance_before: currentBalance,
            balance_after: newBalance,
            card_number: transaction.beneficiary.card_number,
          },
        },
      });
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");

    return { success: true, cancellationId: createdCancellationId };
  } catch (error) {
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
        type: true,
        is_cancelled: true,
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
      const deletable = selected.filter((tx) => !tx.is_cancelled && tx.type !== "CANCELLATION");
      if (deletable.length === 0) return;

      const deletableIds = deletable.map((tx) => tx.id);

      await prisma.$transaction(async (tx) => {
        for (const transactionId of deletableIds) {
          const transactionRecord = await tx.transaction.findUnique({
            where: { id: transactionId },
          });
          if (!transactionRecord) continue;

          // جلب المستفيد مع قفل لمنع التعديل المتزامن
          const lockedBen = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string; completed_via: string | null }>>`
            SELECT id, remaining_balance, status, completed_via FROM "Beneficiary"
            WHERE id = ${transactionRecord.beneficiary_id}
            FOR UPDATE
          `;
          if (lockedBen.length === 0) continue;

          const beneficiary = lockedBen[0];
          const remainingBefore = Number(beneficiary.remaining_balance);
          const refundedAmount = Number(transactionRecord.amount);
          const remainingAfter = roundCurrency(remainingBefore + refundedAmount);

          // تحديث الحركة كأنه محذوف ناعم
          await tx.transaction.update({
            where: { id: transactionId },
            data: { is_cancelled: true },
          });

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
                refunded_amount: refundedAmount,
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
      const restorable = selected.filter((tx) => tx.is_cancelled && tx.corrections.length === 0);
      if (restorable.length === 0) return;

      const restorableIds = restorable.map((tx) => tx.id);

      await prisma.$transaction(async (tx) => {
        for (const transactionId of restorableIds) {
          const transactionRecord = await tx.transaction.findUnique({
            where: { id: transactionId },
          });
          if (!transactionRecord) continue;

          // جلب المستفيد مع قفل لمنع التعديل المتزامن
          const lockedBen = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string; completed_via: string | null }>>`
            SELECT id, remaining_balance, status, completed_via FROM "Beneficiary"
            WHERE id = ${transactionRecord.beneficiary_id}
            FOR UPDATE
          `;
          if (lockedBen.length === 0) continue;

          const beneficiary = lockedBen[0];
          const remainingBefore = Number(beneficiary.remaining_balance);
          const deductedAmount = Number(transactionRecord.amount);
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
                deducted_amount: deductedAmount,
                balance_before: remainingBefore,
                balance_after: remainingAfter,
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
      const deletable = selected.filter((tx) => tx.is_cancelled && tx.type !== "CANCELLATION");
      if (deletable.length === 0) return;

      const validIds = deletable.map((tx) => tx.id);

      await prisma.$transaction(async (tx) => {
        // حركات الإلغاء المرتبطة
        await tx.transaction.deleteMany({
          where: { original_transaction_id: { in: validIds } },
        });

        // الحركات نفسها
        await tx.transaction.deleteMany({
          where: { id: { in: validIds } },
        });

        // تسجيل في سجل المراقبة
        await tx.auditLog.create({
          data: {
            facility_id: session.id,
            user: session.username,
            action: "PERMANENT_DELETE_TRANSACTION",
            metadata: {
              selected_count: ids.length,
              deleted_count: deletable.length,
              transaction_ids: validIds,
              balance_impact: 0,
              message: "تم حذف الحركات نهائياً من قاعدة البيانات بعد إلغائها سابقاً.",
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

    if (hasCancellation) {
      for (const tx of actionable) {
        const result = await deleteCancellationTransaction(tx.id);
        if (result.success) successCount += 1;
        else skippedCount += 1;
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
          },
        },
      });
    } else {
      for (const tx of actionable) {
        const result = await cancelTransaction(tx.id);
        if (result.success) successCount += 1;
        else skippedCount += 1;
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
