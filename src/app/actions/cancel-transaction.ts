"use server";

import prisma from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { deleteCancellationTransaction } from "@/app/actions/restore-transaction";
import { roundCurrency } from "@/lib/money";
import { calculateBeneficiaryBalance, assertBeneficiaryBalanceInvariant } from "@/lib/tx-balance-guard";

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

      let refundAmount = 0;
      if (transaction.type !== "DENTAL") {
        refundAmount = transaction.actual_company_share != null 
          ? Number(transaction.actual_company_share) 
          : Number(transaction.amount);
      }

      // 1. قفل صف المستفيد لمنع race condition
      const locked = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; total_balance: number; status: string }>>`
        SELECT id, remaining_balance, total_balance, status FROM "Beneficiary"
        WHERE id = ${transaction.beneficiary_id}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new Error("المستفيد غير موجود");
      }

      const currentBalance = Number(locked[0].remaining_balance);
      const totalBalance = Number(locked[0].total_balance);
      const lockedStatus = locked[0].status;
      const newBalance = roundCurrency(Math.min(totalBalance, currentBalance + refundAmount));
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

      // 4. Create cancellation transaction (reverse TPA ceiling as well)
      const cancellationData: Record<string, unknown> = {
        beneficiary_id: transaction.beneficiary_id,
        facility_id: session.id,
        amount: -amount,
        type: "CANCELLATION",
        is_cancelled: false,
        original_transaction_id: transactionId,
      };
      // If original had TPA data, copy it to reverse ceiling consumption
      if (transaction.company_id) {
        cancellationData.company_id = transaction.company_id;
        cancellationData.service_category = transaction.service_category;
        cancellationData.ceiling_consumed = transaction.ceiling_consumed
          ? -Number(transaction.ceiling_consumed)
          : 0;
        cancellationData.remaining_ceiling_before = null; // will be recalculated on next deduction
        cancellationData.remaining_ceiling_after = null;
      }
      const cancellationTx = await tx.transaction.create({
        data: cancellationData as any,
      });
      createdCancellationId = cancellationTx.id;

      // FIN-02 FIX: عكس WalletConsumption عند إلغاء حركة TPA
      // يضمن أن السقف السنوي يُستعاد للمستفيد ولا يُفقد نهائياً
      if (transaction.company_id && transaction.ceiling_consumed && Number(transaction.ceiling_consumed) > 0) {
        const walletType = transaction.service_category ?? transaction.type;
        const fiscalYear = transaction.created_at.getFullYear();
        const reverseAmount = Number(transaction.ceiling_consumed);

        await tx.$executeRaw`
          UPDATE "WalletConsumption"
          SET consumed_amount = GREATEST(0, consumed_amount - ${reverseAmount}),
              version = version + 1
          WHERE beneficiary_id = ${transaction.beneficiary_id}
            AND company_id = ${transaction.company_id}
            AND wallet_type = ${walletType}
            AND fiscal_year = ${fiscalYear}
        `;
      }

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

      await assertBeneficiaryBalanceInvariant(tx, transaction.beneficiary_id, "cancelTransaction");

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


export async function bulkTransactionSelectionAction(formData: FormData): Promise<{ error?: string; success?: boolean } | void> {
  const session = await requireActiveFacilitySession();
  if (!session) return { error: "انتهت الجلسة" };

  const op = String(formData.get("op") ?? "cancel_or_rededuct");

  const ids = [...new Set(
    formData
      .getAll("ids")
      .map((value) => String(value))
      .filter((value) => value.length > 0)
  )];

  if (ids.length === 0) {
    return { error: "لم يتم تحديد أي حركات" };
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

    if (selected.length === 0) return { error: "لم يتم العثور على الحركات المحددة" };

    // التمييز بين عمليات الحذف (Soft/Permanent) وبين عمليات الإلغاء القياسية
    const isDeleteOp = ["soft_delete", "restore_delete", "permanent_delete"].includes(op);
    const requiredPermission = isDeleteOp ? "delete_transaction" : "cancel_transactions";

    if (!hasPermission(session, requiredPermission)) {
      return { error: "غير مصرح لك بإجراء هذه العملية" };
    }

    if (op === "soft_delete") {
      const deletable = selected.filter((tx) => {
        if (tx.is_cancelled) return false;
        return tx.type !== "CANCELLATION";
      });
      if (deletable.length === 0) return { error: "لا توجد حركات قابلة للحذف الناعم" };

      const deletableIds = deletable.map((tx) => tx.id);

      await prisma.$transaction(async (tx) => {
        // استعلام واحد لكل الحركات المطلوب حذفها
        const transactionRecords = await tx.transaction.findMany({
          where: { id: { in: deletableIds }, type: { not: "CANCELLATION" } },
        });
        if (transactionRecords.length === 0) return;

        // تحديث جميع الحراقات كحذف ناعم دفعة واحدة
        await tx.transaction.updateMany({
          where: { id: { in: transactionRecords.map((r) => r.id) } },
          data: { is_cancelled: true },
        });

        // تجميع حسب المستفيد لمعالجة كل مستفيد بقفل واحد
        const byBeneficiary = new Map<string, typeof transactionRecords>();
        for (const rec of transactionRecords) {
          const group = byBeneficiary.get(rec.beneficiary_id) || [];
          group.push(rec);
          byBeneficiary.set(rec.beneficiary_id, group);
        }

        for (const [beneficiaryId, records] of byBeneficiary) {
          const lockedBen = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string; completed_via: string | null }>>`
            SELECT id, name, card_number, remaining_balance, status, completed_via FROM "Beneficiary"
            WHERE id = ${beneficiaryId}
            FOR UPDATE
          `;
          if (lockedBen.length === 0) continue;

          const beneficiary = lockedBen[0];
          const remainingBefore = Number(beneficiary.remaining_balance);
          const { remaining_balance: remainingAfter, status: nextStatus } = await calculateBeneficiaryBalance(tx, beneficiaryId);
          await tx.beneficiary.update({
            where: { id: beneficiary.id },
            data: {
              remaining_balance: remainingAfter,
              status: nextStatus,
              completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "MANUAL") : null,
            },
          });

          // سجل تدقيق واحد لكل مستفيد (مع تفاصيل جميع الحركات)
          await tx.auditLog.create({
            data: {
              facility_id: session.id,
              user: session.username,
              action: "SOFT_DELETE_TRANSACTION",
              metadata: {
                transaction_ids: records.map((r) => r.id),
                beneficiary_name: beneficiary.name,
                card_number: beneficiary.card_number,
                total_refunded: roundCurrency(remainingAfter - remainingBefore),
                balance_before: remainingBefore,
                balance_after: remainingAfter,
                count: records.length,
              },
            },
          });

          await assertBeneficiaryBalanceInvariant(tx, beneficiaryId, "bulkTransactionSelectionAction:soft_delete");
        }
      });

      revalidatePath("/transactions");
      revalidatePath("/beneficiaries");
      revalidateTag("beneficiary-counts", "max");
      return;
    }

    if (op === "restore_delete") {
      const restorable = selected.filter((tx) => tx.is_cancelled && tx.corrections.length === 0 && tx.type !== "CANCELLATION");
      if (restorable.length === 0) return { error: "لا توجد حركات قابلة للاستعادة" };

      const restorableIds = restorable.map((tx) => tx.id);

      await prisma.$transaction(async (tx) => {
        const transactionRecords = await tx.transaction.findMany({
          where: { id: { in: restorableIds } },
        });
        if (transactionRecords.length === 0) return;

        // استرجاع جميع الحركات دفعة واحدة
        await tx.transaction.updateMany({
          where: { id: { in: transactionRecords.map((r) => r.id) } },
          data: { is_cancelled: false },
        });

        const byBeneficiary = new Map<string, typeof transactionRecords>();
        for (const rec of transactionRecords) {
          const group = byBeneficiary.get(rec.beneficiary_id) || [];
          group.push(rec);
          byBeneficiary.set(rec.beneficiary_id, group);
        }

        for (const [beneficiaryId, records] of byBeneficiary) {
          const lockedBen = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string; completed_via: string | null }>>`
            SELECT id, name, card_number, remaining_balance, status, completed_via FROM "Beneficiary"
            WHERE id = ${beneficiaryId}
            FOR UPDATE
          `;
          if (lockedBen.length === 0) continue;

          const beneficiary = lockedBen[0];
          const remainingBefore = Number(beneficiary.remaining_balance);

          // FIN-01 FIX: استخدام calculateBeneficiaryBalance لضمان دقة الحساب مع TPA
          // بدل الحساب اليدوي بـ amount الذي يتجاهل actual_company_share
          const { remaining_balance: remainingAfter, status: nextStatus } = await calculateBeneficiaryBalance(tx, beneficiaryId);

          await tx.beneficiary.update({
            where: { id: beneficiary.id },
            data: {
              remaining_balance: remainingAfter,
              status: nextStatus,
              completed_via: nextStatus === "FINISHED" ? (beneficiary.completed_via ?? "MANUAL") : null,
            },
          });

          await tx.auditLog.create({
            data: {
              facility_id: session.id,
              user: session.username,
              action: "RESTORE_SOFT_DELETED_TRANSACTION",
              metadata: {
                transaction_ids: records.map((r) => r.id),
                beneficiary_name: beneficiary.name,
                card_number: beneficiary.card_number,
                total_deducted: roundCurrency(remainingBefore - remainingAfter),
                balance_before: remainingBefore,
                balance_after: remainingAfter,
                count: records.length,
              },
            },
          });

          await assertBeneficiaryBalanceInvariant(tx, beneficiaryId, "bulkTransactionSelectionAction:restore_delete");
        }
      });

      revalidatePath("/transactions");
      revalidatePath("/beneficiaries");
      revalidateTag("beneficiary-counts", "max");
      return;
    }

    if (op === "permanent_delete") {
      // يسمح بالحذف النهائي المباشر لأي حركة محددة (سواء كانت نشطة أو ملغاة) لتسهيل تجربة العميل
      const candidateIds = ids;

      await prisma.$transaction(async (tx) => {
        // SEC-FIX: إعادة الفحص داخل الـ transaction مع قفل FOR UPDATE لمنع TOCTOU
        const lockedTransactions = await tx.$queryRaw<Array<{
          id: string; beneficiary_id: string; amount: number; type: string;
          is_cancelled: boolean; created_at: Date; facility_id: string;
          company_id: string | null; service_category: string | null;
          ceiling_consumed: number | null;
        }>>`
          SELECT id, beneficiary_id, amount::float8 AS amount, type, is_cancelled, created_at, facility_id, company_id, service_category, ceiling_consumed::float8 AS ceiling_consumed
          FROM "Transaction"
          WHERE id = ANY(${candidateIds}::text[])
          FOR UPDATE
        `;

        if (lockedTransactions.length === 0) return;

        // عكس استهلاك السقف التراكمي (Wallet Consumption) للحركات النشطة التي يتم حذفها مباشرة
        for (const transaction of lockedTransactions) {
          if (!transaction.is_cancelled && transaction.type !== "CANCELLATION") {
            if (transaction.company_id && transaction.ceiling_consumed && Number(transaction.ceiling_consumed) > 0) {
              const walletType = transaction.service_category ?? transaction.type;
              const fiscalYear = transaction.created_at.getFullYear();
              const reverseAmount = Number(transaction.ceiling_consumed);

              await tx.$executeRaw`
                UPDATE "WalletConsumption"
                SET consumed_amount = GREATEST(0, consumed_amount - ${reverseAmount}),
                    version = version + 1
                WHERE beneficiary_id = ${transaction.beneficiary_id}
                  AND company_id = ${transaction.company_id}
                  AND wallet_type = ${walletType}
                  AND fiscal_year = ${fiscalYear}
              `;
            }
          }
        }

        const validOriginals = lockedTransactions.filter((t) => t.type !== "CANCELLATION");
        const validCancellations = lockedTransactions.filter((t) => t.type === "CANCELLATION");

        const validOriginalIds = validOriginals.map((t) => t.id);
        const validCancellationIds = validCancellations.map((t) => t.id);

        // SEC-FIX: حفظ snapshot كامل للحركات المحذوفة في سجل التدقيق للمرجعية
        const deletedSnapshot = lockedTransactions.map((t) => ({
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
        const affectedBeneficiaryIds = [...new Set(lockedTransactions.map((t) => t.beneficiary_id))];
        const balanceChanges: Array<{ beneficiary_id: string; beneficiary_name: string; card_number: string; balance_before: number; balance_after: number; status_after: string }> = [];

        // قفل جميع المستفيدين المتأثرين دفعة واحدة
        const lockedAllBens = affectedBeneficiaryIds.length > 0 ? await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string }>>`
          SELECT id, name, card_number, remaining_balance, status FROM "Beneficiary"
          WHERE id = ANY(${affectedBeneficiaryIds}::text[])
          FOR UPDATE
        ` : [];

        const lockedBenMap = new Map(lockedAllBens.map((b) => [b.id, b]));
        for (const beneficiaryId of affectedBeneficiaryIds) {
          const lockedBen = lockedBenMap.get(beneficiaryId);
          if (!lockedBen) continue;

          const { remaining_balance: newBalance, status: newStatus } = await calculateBeneficiaryBalance(tx, beneficiaryId);
          const beneficiaryMeta = await tx.beneficiary.findUnique({
            where: { id: beneficiaryId },
            select: { total_balance: true, completed_via: true },
          });

          if (!beneficiaryMeta) continue;

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

          await assertBeneficiaryBalanceInvariant(tx, beneficiaryId, "bulkTransactionSelectionAction:permanent_delete");

          balanceChanges.push({
            beneficiary_id: beneficiaryId,
            beneficiary_name: lockedBen.name,
            card_number: lockedBen.card_number,
            balance_before: Number(lockedBen.remaining_balance),
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
              deleted_count: lockedTransactions.length,
              transaction_ids: lockedTransactions.map((t) => t.id),
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
    if (actionable.length === 0) return { error: "لا توجد حركات غير ملغاة للمعالجة" };

    const hasCancellation = actionable.some((tx) => tx.type === "CANCELLATION");
    const hasNormal = actionable.some((tx) => tx.type !== "CANCELLATION");

    if (hasCancellation && hasNormal) {
      return { error: "لا يمكن معالجة حركات إلغاء وحركات عادية معاً — يرجى فصل التحديد" };
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

    if (skippedCount > 0) {
      return { error: `تم معالجة ${successCount} حركة، وفشل معالجة ${skippedCount} حركة. قد يكون هناك حركات لا يمكن إلغاؤها.` };
    }
    return {};
  } catch (error) {
    logger.error("Bulk mixed transaction action error", { error: String(error) });
    return { error: "حدث خطأ أثناء تنفيذ العملية" };
  }
}
