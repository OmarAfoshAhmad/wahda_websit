"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { deleteCancellationTransaction } from "@/app/actions/restore-transaction";

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
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number }>>`
        SELECT id, remaining_balance FROM "Beneficiary"
        WHERE id = ${transaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const currentBalance = Number(locked[0].remaining_balance);
      const newBalance = currentBalance + amount;

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
          status: "ACTIVE",
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

      // 5. Audit Log
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "CANCEL_TRANSACTION",
          metadata: {
            original_transaction_id: transactionId,
            refunded_amount: amount,
            beneficiary_card: transaction.beneficiary.card_number,
          },
        },
      });
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    
    return { success: true, cancellationId: createdCancellationId };
  } catch (error) {
    logger.error("Cancellation error", { error: String(error) });
    return { error: "فشل في إلغاء المعاملة" };
  }
}

export async function bulkCancelTransactions(formData: FormData): Promise<void> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "cancel_transactions")) {
    return;
  }

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
    let successCount = 0;
    let skippedCount = 0;

    for (const id of ids) {
      const result = await cancelTransaction(id);
      if (result.success) {
        successCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "BULK_CANCEL_TRANSACTION",
        metadata: {
          selected_count: ids.length,
          cancelled_count: successCount,
          skipped_count: skippedCount,
          transaction_ids: ids,
        },
      },
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
  } catch (error) {
    logger.error("Bulk cancellation error", { error: String(error) });
  }
}

export async function bulkTransactionSelectionAction(formData: FormData): Promise<void> {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "cancel_transactions")) {
    return;
  }

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

    if (op === "soft_delete") {
      const deletable = selected.filter((tx) => !tx.is_cancelled && tx.type !== "CANCELLATION");
      if (deletable.length === 0) return;

      const validIds = deletable.map((tx) => tx.id);

      // إعادة حساب الأرصدة ضمن transaction واحدة لضمان الذرية
      await prisma.$transaction(async (tx) => {
        await tx.transaction.updateMany({
          where: { id: { in: validIds } },
          data: { is_cancelled: true },
        });

        // جلب beneficiary_id لكل حركة مُلغاة
        const affectedTxs = await tx.transaction.findMany({
          where: { id: { in: validIds } },
          select: { beneficiary_id: true },
        });
        const affectedBeneficiaryIds = [...new Set(affectedTxs.map((t) => t.beneficiary_id))];

        // إعادة حساب رصيد كل مستفيد متأثر
        for (const beneficiaryId of affectedBeneficiaryIds) {
          const beneficiary = await tx.beneficiary.findUnique({
            where: { id: beneficiaryId },
            select: { id: true, total_balance: true, status: true, completed_via: true },
          });
          if (!beneficiary) continue;

          const activeSum = await tx.transaction.aggregate({
            where: { beneficiary_id: beneficiaryId, is_cancelled: false, type: { not: "CANCELLATION" } },
            _sum: { amount: true },
          });
          const spent = Number(activeSum._sum.amount ?? 0);
          const remaining = Math.max(0, Number(beneficiary.total_balance) - spent);
          const nextStatus = beneficiary.status === "SUSPENDED" ? "SUSPENDED" : remaining <= 0 ? "FINISHED" : "ACTIVE";

          await tx.beneficiary.update({
            where: { id: beneficiaryId },
            data: {
              remaining_balance: remaining,
              status: nextStatus,
              completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "MANUAL") : null,
            },
          });
        }
      });

      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_SOFT_DELETE_TRANSACTION",
          metadata: {
            selected_count: ids.length,
            deleted_count: deletable.length,
            skipped_count: ids.length - deletable.length,
            transaction_ids: deletable.map((item) => item.id),
          },
        },
      });

      revalidatePath("/transactions");
      revalidatePath("/beneficiaries");
      return;
    }

    if (op === "restore_delete") {
      const restorable = selected.filter((tx) => tx.is_cancelled && tx.corrections.length === 0);
      if (restorable.length === 0) return;

      const validIds = restorable.map((tx) => tx.id);

      // إعادة حساب الأرصدة ضمن transaction واحدة لضمان الذرية
      await prisma.$transaction(async (tx) => {
        await tx.transaction.updateMany({
          where: { id: { in: validIds } },
          data: { is_cancelled: false },
        });

        // جلب beneficiary_id لكل حركة مسترجعة
        const affectedTxs = await tx.transaction.findMany({
          where: { id: { in: validIds } },
          select: { beneficiary_id: true },
        });
        const affectedBeneficiaryIds = [...new Set(affectedTxs.map((t) => t.beneficiary_id))];

        // إعادة حساب رصيد كل مستفيد متأثر
        for (const beneficiaryId of affectedBeneficiaryIds) {
          const beneficiary = await tx.beneficiary.findUnique({
            where: { id: beneficiaryId },
            select: { id: true, total_balance: true, status: true, completed_via: true },
          });
          if (!beneficiary) continue;

          const activeSum = await tx.transaction.aggregate({
            where: { beneficiary_id: beneficiaryId, is_cancelled: false, type: { not: "CANCELLATION" } },
            _sum: { amount: true },
          });
          const spent = Number(activeSum._sum.amount ?? 0);
          const remaining = Math.max(0, Number(beneficiary.total_balance) - spent);
          const nextStatus = beneficiary.status === "SUSPENDED" ? "SUSPENDED" : remaining <= 0 ? "FINISHED" : "ACTIVE";

          await tx.beneficiary.update({
            where: { id: beneficiaryId },
            data: {
              remaining_balance: remaining,
              status: nextStatus,
              completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "MANUAL") : null,
            },
          });
        }
      });

      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "BULK_RESTORE_SOFT_DELETED_TRANSACTION",
          metadata: {
            selected_count: ids.length,
            restored_count: restorable.length,
            skipped_count: ids.length - restorable.length,
            transaction_ids: validIds,
          },
        },
      });

      revalidatePath("/transactions");
      revalidatePath("/beneficiaries");
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
  } catch (error) {
    logger.error("Bulk mixed transaction action error", { error: String(error) });
  }
}
