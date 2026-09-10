"use server";

import prisma from "@/lib/prisma";
import { resolveVerifiedSuperAdminActor } from "@/lib/super-admin-actor";
import { AUDIT_ACTIONS } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import {
  MIN_VALID_TRANSACTION_DATE,
  parseDateOnlyAsNoonUtc,
  suggestSwappedDate,
  tripoliIsoDate,
  validateCorrectedDate,
} from "@/lib/transaction-date-anomaly";

const CEILING_SENSITIVE_TYPES = new Set(["DENTAL", "OPTICS", "PHYSIOTHERAPY"]);

export type OutOfRangeDateRow = {
  id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  facility_name: string;
  type: string;
  service_category: string | null;
  amount: number;
  created_at: Date;
  anomaly: "FUTURE" | "TOO_OLD";
  /** تاريخ مقترح بقلب اليوم والشهر إن أنتج تاريخاً منطقياً؛ وإلا null. */
  suggested_date: string | null;
};

export async function listOutOfRangeTransactionDatesAction(companyId: string, limit = 500): Promise<{
  success: boolean;
  rows: OutOfRangeDateRow[];
  error?: string;
}> {
  const actor = await resolveVerifiedSuperAdminActor();
  if (!actor) {
    return { success: false, rows: [], error: "غير مصرح" };
  }

  try {
    const rows = await prisma.$queryRaw<Array<Omit<OutOfRangeDateRow, "suggested_date">>>`
      SELECT
        t.id,
        t.beneficiary_id,
        b.name AS beneficiary_name,
        b.card_number,
        f.name AS facility_name,
        t.type::text AS type,
        t.service_category,
        t.amount::float8 AS amount,
        t.created_at,
        CASE WHEN t.created_at > NOW() THEN 'FUTURE' ELSE 'TOO_OLD' END AS anomaly
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      JOIN "Facility" f ON f.id = t.facility_id
      WHERE t.company_id = ${companyId}
        AND t.is_cancelled = false
        AND (t.created_at > NOW() OR t.created_at < ${MIN_VALID_TRANSACTION_DATE})
      ORDER BY t.created_at DESC
      LIMIT ${limit}
    `;
    const today = tripoliIsoDate();
    return {
      success: true,
      rows: rows.map((row) => ({ ...row, suggested_date: suggestSwappedDate(row.created_at, today) })),
    };
  } catch (err) {
    console.error("[listOutOfRangeTransactionDatesAction]", err);
    return { success: false, rows: [], error: "تعذر جلب الحركات ذات التواريخ الشاذة" };
  }
}

type Actor = { id: string; username: string };
type TxClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

async function applyDateChange(
  tx: TxClient,
  actor: Actor,
  transactionId: string,
  newDate: Date,
  source: string,
): Promise<{ needsCeilingRecalc: boolean }> {
  const locked = await tx.$queryRaw<Array<{ id: string; is_cancelled: boolean; created_at: Date; type: string; company_id: string | null; beneficiary_id: string }>>`
    SELECT id, is_cancelled, created_at, type::text AS type, company_id, beneficiary_id
    FROM "Transaction"
    WHERE id = ${transactionId}
    FOR UPDATE
  `;
  const current = locked[0];
  if (!current) throw new Error("الحركة غير موجودة");
  if (current.is_cancelled) throw new Error("لا يمكن تعديل تاريخ حركة ملغاة");

  const beneficiary = await tx.beneficiary.findUnique({
    where: { id: current.beneficiary_id },
    select: { name: true, card_number: true },
  });

  await tx.transaction.update({
    where: { id: current.id },
    data: { created_at: newDate },
  });

  const oldYear = current.created_at.getFullYear();
  const newYear = newDate.getFullYear();
  const needsCeilingRecalc = CEILING_SENSITIVE_TYPES.has(current.type) && oldYear !== newYear;

  await tx.auditLog.create({
    data: {
      facility_id: actor.id,
      company_id: current.company_id,
      user: actor.username,
      action: AUDIT_ACTIONS.EDIT_TRANSACTION,
      metadata: {
        source,
        transaction_id: current.id,
        beneficiary_name: beneficiary?.name ?? null,
        card_number: beneficiary?.card_number ?? null,
        type: current.type,
        old_date: current.created_at.toISOString(),
        new_date: newDate.toISOString(),
        fiscal_year_changed: oldYear !== newYear,
        needs_ceiling_recalc: needsCeilingRecalc,
      },
    },
  });

  return { needsCeilingRecalc };
}

function toUserError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  return /[؀-ۿ]/.test(message) ? message : fallback;
}

export async function fixTransactionDateAction(input: {
  transactionId: string;
  newDate: string;
}): Promise<{ success: boolean; error?: string; needsCeilingRecalc?: boolean }> {
  const actor = await resolveVerifiedSuperAdminActor();
  if (!actor) {
    return { success: false, error: "غير مصرح — مخصص للمبرمج فقط" };
  }

  const transactionId = String(input.transactionId ?? "").trim();
  if (!transactionId) return { success: false, error: "معرف الحركة مطلوب" };

  const validated = validateCorrectedDate(String(input.newDate ?? "").trim());
  if (!validated.ok) return { success: false, error: validated.error };

  try {
    const result = await prisma.$transaction((tx) =>
      applyDateChange(tx, actor, transactionId, validated.date, "data_health_out_of_range_date_manual"),
    );
    revalidatePath("/admin/duplicates");
    revalidatePath("/transactions");
    return { success: true, needsCeilingRecalc: result.needsCeilingRecalc };
  } catch (err) {
    console.error("[fixTransactionDateAction]", err);
    return { success: false, error: toUserError(err, "تعذر تصحيح تاريخ الحركة") };
  }
}

/**
 * يطبّق اقتراحات القلب على كل الحركات الشاذة للشركة دفعة واحدة (كل شيء أو لا شيء).
 * يُعاد حساب الاقتراح وقت التنفيذ ولا يُقبل من العميل، فلا يمكن تمرير تاريخ عشوائي.
 */
export async function applySuggestedTransactionDatesAction(companyId: string): Promise<{
  success: boolean;
  error?: string;
  appliedCount?: number;
  needsCeilingRecalcCount?: number;
}> {
  const actor = await resolveVerifiedSuperAdminActor();
  if (!actor) {
    return { success: false, error: "غير مصرح — مخصص للمبرمج فقط" };
  }

  const listed = await listOutOfRangeTransactionDatesAction(companyId, 5000);
  if (!listed.success) return { success: false, error: listed.error };

  const candidates = listed.rows.filter((row): row is OutOfRangeDateRow & { suggested_date: string } => row.suggested_date !== null);
  if (candidates.length === 0) {
    return { success: true, appliedCount: 0, needsCeilingRecalcCount: 0 };
  }

  try {
    const needsRecalc = await prisma.$transaction(
      async (tx) => {
        let count = 0;
        for (const row of candidates) {
          const result = await applyDateChange(
            tx,
            actor,
            row.id,
            parseDateOnlyAsNoonUtc(row.suggested_date),
            "data_health_out_of_range_date_swap_bulk",
          );
          if (result.needsCeilingRecalc) count++;
        }
        return count;
      },
      { timeout: 120_000 },
    );

    revalidatePath("/admin/duplicates");
    revalidatePath("/transactions");
    return { success: true, appliedCount: candidates.length, needsCeilingRecalcCount: needsRecalc };
  } catch (err) {
    console.error("[applySuggestedTransactionDatesAction]", err);
    return { success: false, error: toUserError(err, "تعذر تطبيق الاقتراحات — لم يُغيَّر أي صف") };
  }
}
