"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { roundCurrency } from "@/lib/money";

import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

export async function deleteCancellationTransaction(cancellationId: string) {
  try {
    const session = await requireActiveFacilitySession();
    const canRededuct = !!session && (hasPermission(session, 'correct_transactions') || hasPermission(session, 'cancel_transactions'));
    if (!canRededuct) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    let details: {
      transaction_id: string;
      original_transaction_id: string;
      beneficiary_name: string;
      card_number: string;
      amount: number;
      balance_before: number;
      balance_after: number;
    } | null = null;

    // FIX TOCTOU: نقرأ الحركة داخل الـ Transaction لمنع تغير البيانات بين القراءة والقفل
    await prisma.$transaction(async (tx) => {
      const cancellationTransaction = await tx.transaction.findUnique({
        where: { id: cancellationId },
        select: {
          id: true,
          type: true,
          beneficiary_id: true,
          original_transaction_id: true,
          amount: true,
          beneficiary: { select: { name: true, card_number: true } },
        },
      });

      if (!cancellationTransaction) {
        throw new Error("CANCELLATION_NOT_FOUND");
      }

      if (cancellationTransaction.type !== "CANCELLATION") {
        throw new Error("NOT_CANCELLATION");
      }

      if (!cancellationTransaction.original_transaction_id) {
        throw new Error("NO_ORIGINAL_TRANSACTION");
      }

      const refundAmountReversed = Math.abs(Number(cancellationTransaction.amount));

      // 1. قفل صف المستفيد لمنع race condition
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string }>>`
        SELECT id, remaining_balance, status FROM "Beneficiary"
        WHERE id = ${cancellationTransaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const currentBalance = Number(locked[0].remaining_balance);
      const lockedStatus = locked[0].status;

      // 2. Mark original transaction as valid (not cancelled)
      await tx.transaction.update({
        where: { id: cancellationTransaction.original_transaction_id! },
        data: { is_cancelled: false },
      });

      // 3. SEC-FIX: إلغاء حركة الإلغاء بدل حذفها نهائياً — للحفاظ على سلسلة الأثر المالية
      await tx.transaction.update({
        where: { id: cancellationId },
        data: { is_cancelled: true },
      });

      // 4. إعادة احتساب الرصيد من دفتر الحركات الفعلي لضمان الدقة
      const beneficiaryAfterOps = await tx.beneficiary.findUnique({
        where: { id: cancellationTransaction.beneficiary_id },
        select: { total_balance: true, completed_via: true },
      });

      if (!beneficiaryAfterOps) {
        throw new Error("BENEFICIARY_NOT_FOUND");
      }

      const agg = await tx.transaction.aggregate({
        where: {
          beneficiary_id: cancellationTransaction.beneficiary_id,
          is_cancelled: false,
          type: { not: "CANCELLATION" },
        },
        _sum: { amount: true },
      });

      const totalBalance = Number(beneficiaryAfterOps.total_balance);
      const totalSpent = Number(agg._sum.amount ?? 0);
      const newBalance = roundCurrency(Math.max(0, totalBalance - totalSpent));
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
        beneficiaryUpdateData.completed_via = (beneficiaryAfterOps.completed_via as "MANUAL" | "IMPORT" | null) ?? "MANUAL";
      } else if (newStatus !== "SUSPENDED") {
        beneficiaryUpdateData.completed_via = null;
      }

      await tx.beneficiary.update({
        where: { id: cancellationTransaction.beneficiary_id },
        data: beneficiaryUpdateData,
      });

      // 5. Audit Log — مع تسجيل الرصيد قبل وبعد
      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "REVERT_CANCELLATION",
          metadata: {
            cancellation_transaction_id: cancellationId,
            original_transaction_id: cancellationTransaction.original_transaction_id,
            beneficiary_name: cancellationTransaction.beneficiary.name,
            re_deducted_amount: refundAmountReversed,
            card_number: cancellationTransaction.beneficiary.card_number,
            balance_before: currentBalance,
            balance_after: newBalance,
          },
        },
      });

      details = {
        transaction_id: cancellationTransaction.id,
        original_transaction_id: String(cancellationTransaction.original_transaction_id),
        beneficiary_name: String(cancellationTransaction.beneficiary.name),
        card_number: String(cancellationTransaction.beneficiary.card_number),
        amount: refundAmountReversed,
        balance_before: currentBalance,
        balance_after: newBalance,
      };
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");

    return { success: true, details };

  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "CANCELLATION_NOT_FOUND") return { error: "معاملة الإلغاء غير موجودة" };
    if (msg === "NOT_CANCELLATION") return { error: "هذه المعاملة ليست معاملة إلغاء" };
    if (msg === "NO_ORIGINAL_TRANSACTION") return { error: "لا يوجد معرف للمعاملة الأصلية" };
    logger.error("Revert cancellation error", { error: String(error) });
    return { error: "فشل في التراجع عن الإلغاء" };
  }
}

export async function deleteCancellationPair(cancellationId: string) {
  try {
    const session = await requireActiveFacilitySession();
    if (!session || !hasPermission(session, 'delete_transaction')) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    await prisma.$transaction(async (tx) => {
      const cancellation = await tx.transaction.findUnique({
        where: { id: cancellationId },
        select: {
          id: true,
          type: true,
          is_cancelled: true,
          beneficiary_id: true,
          original_transaction_id: true,
          beneficiary: { select: { name: true, card_number: true } },
        },
      });

      if (!cancellation) throw new Error("CANCELLATION_NOT_FOUND");
      if (cancellation.type !== "CANCELLATION") throw new Error("NOT_CANCELLATION");
      if (!cancellation.original_transaction_id) throw new Error("NO_ORIGINAL_TRANSACTION");

      const originalTx = await tx.transaction.findUnique({
        where: { id: cancellation.original_transaction_id },
        select: {
          id: true,
          type: true,
          is_cancelled: true,
          beneficiary_id: true,
        },
      });

      if (!originalTx) throw new Error("ORIGINAL_NOT_FOUND");

      // قفل صف المستفيد قبل أي تعديل
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM "Beneficiary"
        WHERE id = ${cancellation.beneficiary_id}
        FOR UPDATE
      `;
      if (locked.length === 0) throw new Error("BENEFICIARY_NOT_FOUND");

      const beneficiaryBalanceBefore = await tx.beneficiary.findUnique({
        where: { id: cancellation.beneficiary_id },
        select: { remaining_balance: true },
      });

      await tx.transaction.deleteMany({
        where: {
          id: { in: [cancellation.id, originalTx.id] },
        },
      });

      // إعادة احتساب الرصيد من دفتر الحركات الفعلي بعد حذف الزوج
      const beneficiaryAfterOps = await tx.beneficiary.findUnique({
        where: { id: cancellation.beneficiary_id },
        select: { total_balance: true, completed_via: true },
      });
      if (!beneficiaryAfterOps) throw new Error("BENEFICIARY_NOT_FOUND");

      const agg = await tx.transaction.aggregate({
        where: {
          beneficiary_id: cancellation.beneficiary_id,
          is_cancelled: false,
          type: { not: "CANCELLATION" },
        },
        _sum: { amount: true },
      });

      const totalBalance = Number(beneficiaryAfterOps.total_balance);
      const totalSpent = Number(agg._sum.amount ?? 0);
      const newBalance = roundCurrency(Math.max(0, totalBalance - totalSpent));
      const lockedStatus = locked[0].status;
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
        beneficiaryUpdateData.completed_via = (beneficiaryAfterOps.completed_via as "MANUAL" | "IMPORT" | null) ?? "MANUAL";
      } else if (newStatus !== "SUSPENDED") {
        beneficiaryUpdateData.completed_via = null;
      }

      await tx.beneficiary.update({
        where: { id: cancellation.beneficiary_id },
        data: beneficiaryUpdateData,
      });

      await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "PERMANENT_DELETE_TRANSACTION",
          metadata: {
            pair_delete: true,
            cancellation_transaction_id: cancellation.id,
            original_transaction_id: originalTx.id,
            beneficiary_name: cancellation.beneficiary.name,
            card_number: cancellation.beneficiary.card_number,
            balance_before: Number(beneficiaryBalanceBefore?.remaining_balance ?? 0),
            balance_after: newBalance,
            message: "تم حذف زوج الإلغاء والتصحيح نهائياً مع إعادة احتساب الرصيد.",
          },
        },
      });
    });

    revalidatePath("/transactions");
    revalidatePath("/beneficiaries");
    revalidateTag("beneficiary-counts", "max");
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "CANCELLATION_NOT_FOUND") return { error: "حركة التصحيح غير موجودة" };
    if (msg === "NOT_CANCELLATION") return { error: "هذه ليست حركة تصحيح" };
    if (msg === "NO_ORIGINAL_TRANSACTION") return { error: "لا يوجد ارتباط بالحركة الأصلية" };
    if (msg === "ORIGINAL_NOT_FOUND") return { error: "الحركة الأصلية غير موجودة" };
    logger.error("Delete cancellation pair error", { error: String(error) });
    return { error: "فشل حذف زوج الإلغاء والتصحيح" };
  }
}
