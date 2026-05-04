"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { 
  InvalidSubunitAmountFixResult, 
  BackgroundActor 
} from "./types";
import { roundCurrency } from "@/lib/money";

function normalizeSubunitAmountToAllowed(amount: number): number {
  return amount < 0.5 ? 0.25 : 0.5;
}

export async function runFixInvalidSubunitAmountsAction(
  actor?: BackgroundActor,
): Promise<InvalidSubunitAmountFixResult> {
  const session = actor
    ? { id: actor.id, username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
    
  if (!session?.is_admin) {
    return {
      success: false,
      candidates_count: 0,
      fixed_count: 0,
      skipped_count: 0,
      total_delta: 0,
      error: "غير مصرح",
    };
  }

  try {
    const candidates = await prisma.transaction.findMany({
      where: {
        is_cancelled: false,
        type: { not: "CANCELLATION" },
        amount: { gt: 0, lt: 1 },
        NOT: [{ amount: 0.25 }, { amount: 0.5 }],
        beneficiary: { deleted_at: null },
      },
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        beneficiary_id: true,
        amount: true,
        type: true,
      },
      take: 5000,
    });

    const details: Array<Record<string, unknown>> = [];
    let fixedCount = 0;
    let skippedCount = 0;
    let totalDelta = 0;

    for (const candidate of candidates) {
      await prisma.$transaction(async (tx) => {
        const transactionRow = await tx.transaction.findUnique({
          where: { id: candidate.id },
          select: {
            id: true,
            beneficiary_id: true,
            amount: true,
            type: true,
            is_cancelled: true,
          },
        });

        if (!transactionRow || transactionRow.is_cancelled || transactionRow.type === "CANCELLATION") {
          skippedCount += 1;
          return;
        }

        const beneficiaryRows = await tx.$queryRaw<Array<{ id: string; remaining_balance: number; status: string; completed_via: string | null }>>`
          SELECT id, remaining_balance, status::text, completed_via
          FROM "Beneficiary"
          WHERE id = ${transactionRow.beneficiary_id}
            AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE
        `;

        if (beneficiaryRows.length === 0) {
          skippedCount += 1;
          return;
        }

        const beneficiary = beneficiaryRows[0];
        const previousAmount = Number(transactionRow.amount);
        if (!(previousAmount > 0 && previousAmount < 1) || previousAmount === 0.25 || previousAmount === 0.5) {
          skippedCount += 1;
          return;
        }

        const nextAmount = normalizeSubunitAmountToAllowed(previousAmount);
        const delta = roundCurrency(nextAmount - previousAmount);
        const currentRemaining = Number(beneficiary.remaining_balance);
        const nextRemaining = roundCurrency(currentRemaining - delta);

        if (nextRemaining < 0) {
          skippedCount += 1;
          details.push({
            transaction_id: transactionRow.id,
            beneficiary_id: beneficiary.id,
            before_amount: previousAmount,
            after_amount: nextAmount,
            delta,
            skipped_reason: "remaining_would_be_negative",
          });
          return;
        }

        const nextStatus = beneficiary.status === "SUSPENDED"
          ? "SUSPENDED"
          : (nextRemaining <= 0 ? "FINISHED" : "ACTIVE");

        await tx.transaction.update({
          where: { id: transactionRow.id },
          data: { amount: nextAmount },
        });

        await tx.beneficiary.update({
          where: { id: beneficiary.id },
          data: {
            remaining_balance: nextRemaining,
            status: nextStatus as "ACTIVE" | "FINISHED" | "SUSPENDED",
            completed_via: nextStatus === "SUSPENDED"
              ? beneficiary.completed_via
              : (nextStatus === "FINISHED"
                ? (transactionRow.type === "IMPORT" ? "IMPORT" : "MANUAL")
                : null),
          },
        });

        fixedCount += 1;
        totalDelta = roundCurrency(totalDelta + delta);
        details.push({
          transaction_id: transactionRow.id,
          beneficiary_id: beneficiary.id,
          transaction_type: transactionRow.type,
          before_amount: previousAmount,
          after_amount: nextAmount,
          delta,
          before_remaining_balance: currentRemaining,
          after_remaining_balance: nextRemaining,
          result: "fixed",
        });
      });
    }

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: AUDIT_ACTIONS.FIX_INVALID_SUBUNIT_AMOUNTS,
        metadata: {
          candidates_count: candidates.length,
          fixed_count: fixedCount,
          skipped_count: skippedCount,
          total_delta: totalDelta,
          allowed_values: [0.25, 0.5],
          details,
        },
      },
    });

    if (!actor) {
      revalidatePath("/admin/db-anomalies");
      revalidatePath("/admin/balance-health");
      revalidatePath("/admin/duplicates");
      revalidatePath("/transactions");
    }

    return {
      success: true,
      candidates_count: candidates.length,
      fixed_count: fixedCount,
      skipped_count: skippedCount,
      total_delta: totalDelta,
    };
  } catch (error) {
    console.error("[runFixInvalidSubunitAmountsAction]", error);
    return {
      success: false,
      candidates_count: 0,
      fixed_count: 0,
      skipped_count: 0,
      total_delta: 0,
      error: "تعذر تنفيذ معالجة القيم المخالفة",
    };
  }
}
