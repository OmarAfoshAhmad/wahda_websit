"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { 
  ImportIntegerDistributionFixResult, 
  BackgroundActor 
} from "./types";
import { roundCurrency } from "@/lib/money";

export async function runNormalizeImportIntegerDistributionAction(
  actor?: BackgroundActor,
): Promise<ImportIntegerDistributionFixResult> {
  const session = actor
    ? { id: actor.id, username: actor.username, is_admin: actor.isAdmin }
    : await getSession();
    
  if (!session?.is_admin) {
    return {
      success: false,
      processed_families: 0,
      processed_members: 0,
      updated_transactions: 0,
      created_transactions: 0,
      cancelled_transactions: 0,
      error: "غير مصرح",
    };
  }

  try {
    const familyCandidates = await prisma.$queryRaw<Array<{ family_base_card: string }>>`
      WITH family_imports AS (
        SELECT
          COALESCE(SUBSTRING(b.card_number FROM '^(WAB2025[0-9]+)'), b.card_number) AS family_base_card,
          t.id,
          t.beneficiary_id,
          t.amount
        FROM "Transaction" t
        JOIN "Beneficiary" b ON b.id = t.beneficiary_id
        WHERE t.type = 'IMPORT'
          AND t.is_cancelled = false
          AND b.deleted_at IS NULL
      )
      SELECT family_base_card
      FROM family_imports
      GROUP BY family_base_card
      HAVING
        BOOL_OR(ABS(amount - ROUND(amount)) > 0.000001)
        OR COUNT(id) > COUNT(DISTINCT beneficiary_id)
      ORDER BY family_base_card
      LIMIT 5000
    `;

    const details: Array<Record<string, unknown>> = [];
    const undoSnapshot: Array<Record<string, unknown>> = [];
    let processedFamilies = 0;
    let processedMembers = 0;
    let updatedTransactions = 0;
    let createdTransactions = 0;
    let cancelledTransactions = 0;

    for (const candidate of familyCandidates) {
      const familyBaseCard = String(candidate.family_base_card ?? "").trim();
      if (!familyBaseCard) continue;

      await prisma.$transaction(async (tx) => {
        const familyMembers = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; remaining_balance: number; status: string; completed_via: string | null }>>`
          SELECT id, name, card_number, remaining_balance, status::text, completed_via
          FROM "Beneficiary"
          WHERE deleted_at IS NULL
            AND card_number LIKE ${familyBaseCard + "%"}
          ORDER BY card_number ASC
          FOR UPDATE
        `;

        if (familyMembers.length === 0) return;

        const memberIds = familyMembers.map((m) => m.id);
        const importTxs = await tx.transaction.findMany({
          where: {
            beneficiary_id: { in: memberIds },
            type: "IMPORT",
            is_cancelled: false,
          },
          orderBy: { created_at: "asc" },
          select: {
            id: true,
            beneficiary_id: true,
            amount: true,
            is_cancelled: true,
          },
        });

        if (importTxs.length === 0) return;

        const totalUsed = Math.max(0, Math.round(importTxs.reduce((sum, txItem) => sum + Number(txItem.amount), 0)));
        const divisor = Math.max(1, familyMembers.length);
        const baseShare = Math.floor(totalUsed / divisor);
        const remainder = totalUsed - baseShare * divisor;

        const importsByMember = new Map<string, Array<{ id: string; amount: number }>>();
        for (const txItem of importTxs) {
          const arr = importsByMember.get(txItem.beneficiary_id) ?? [];
          arr.push({ id: txItem.id, amount: Number(txItem.amount) });
          importsByMember.set(txItem.beneficiary_id, arr);
        }

        const createdIdsForFamily: string[] = [];
        const memberSnapshots: Array<Record<string, unknown>> = [];

        for (let i = 0; i < familyMembers.length; i++) {
          const member = familyMembers[i];
          const existingForMember = importsByMember.get(member.id) ?? [];
          const previousImported = existingForMember.reduce((sum, item) => sum + Number(item.amount), 0);
          const balanceBeforeImport = Number(member.remaining_balance) + previousImported;
          const deductAmount = i === 0 ? baseShare + remainder : baseShare;
          const newBalance = Math.max(0, roundCurrency(balanceBeforeImport - deductAmount));
          const newStatus = member.status === "SUSPENDED"
            ? "SUSPENDED"
            : (newBalance <= 0 ? "FINISHED" : "ACTIVE");

          memberSnapshots.push({
            id: member.id,
            before_remaining_balance: Number(member.remaining_balance),
            before_status: member.status,
            before_completed_via: member.completed_via,
            tx_before: existingForMember,
          });

          await tx.beneficiary.update({
            where: { id: member.id },
            data: {
              remaining_balance: newBalance,
              status: newStatus as "ACTIVE" | "FINISHED" | "SUSPENDED",
              completed_via: newStatus === "FINISHED"
                ? "IMPORT"
                : (newStatus === "SUSPENDED" ? member.completed_via : null),
            },
          });

          if (existingForMember.length === 0) {
            if (deductAmount > 0) {
              const createdTx = await tx.transaction.create({
                data: {
                  beneficiary_id: member.id,
                  facility_id: session.id,
                  amount: deductAmount,
                  type: "IMPORT",
                },
                select: { id: true },
              });
              createdIdsForFamily.push(createdTx.id);
              createdTransactions += 1;
            }
          } else {
            await tx.transaction.update({
              where: { id: existingForMember[0].id },
              data: { amount: deductAmount },
            });
            updatedTransactions += 1;

            if (existingForMember.length > 1) {
              const extraIds = existingForMember.slice(1).map((item) => item.id);
              const cancelled = await tx.transaction.updateMany({
                where: { id: { in: extraIds }, is_cancelled: false },
                data: { is_cancelled: true },
              });
              cancelledTransactions += cancelled.count;
            }
          }

          details.push({
            family_base_card: familyBaseCard,
            beneficiary_id: member.id,
            beneficiary_name: member.name,
            card_number: member.card_number,
            before_import_total: roundCurrency(previousImported),
            after_import_total: deductAmount,
            before_remaining_balance: roundCurrency(Number(member.remaining_balance)),
            after_remaining_balance: roundCurrency(newBalance),
            result: "updated",
          });
          processedMembers += 1;
        }

        undoSnapshot.push({
          family_base_card: familyBaseCard,
          created_transaction_ids: createdIdsForFamily,
          members: memberSnapshots,
        });
        processedFamilies += 1;
      });
    }

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: AUDIT_ACTIONS.NORMALIZE_IMPORT_INTEGER_DISTRIBUTION,
        metadata: {
          processed_families: processedFamilies,
          processed_members: processedMembers,
          updated_transactions: updatedTransactions,
          created_transactions: createdTransactions,
          cancelled_transactions: cancelledTransactions,
          details,
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
      processed_families: processedFamilies,
      processed_members: processedMembers,
      updated_transactions: updatedTransactions,
      created_transactions: createdTransactions,
      cancelled_transactions: cancelledTransactions,
    };
  } catch (error) {
    console.error("[runNormalizeImportIntegerDistributionAction]", error);
    return {
      success: false,
      processed_families: 0,
      processed_members: 0,
      updated_transactions: 0,
      created_transactions: 0,
      cancelled_transactions: 0,
      error: "تعذر تنفيذ معالجة التوزيع الصحيح للحصص",
    };
  }
}
