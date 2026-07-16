import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { assertBeneficiaryBalanceInvariant } from "@/lib/tx-balance-guard";
import { roundCurrency } from "@/lib/money";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: NextRequest, context: { params: Promise<{ logId: string }> }) {
  const session = await requireActiveFacilitySession();
  if (!session || (!session.is_admin && !hasPermission(session, "correct_transactions"))) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }
  const { logId } = await context.params;
  const body = await request.json().catch(() => null) as { mode?: unknown } | null;
  const mode = body?.mode === "undo" ? "undo" : body?.mode === "redo" ? "redo" : null;
  if (!mode) return NextResponse.json({ error: "نوع الإجراء غير صالح" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const logs = await tx.$queryRaw<Array<{ id: string; action: string; metadata: unknown }>>`
        SELECT id, action, metadata FROM "AuditLog" WHERE id = ${logId} FOR UPDATE
      `;
      const source = logs[0];
      if (!source) throw new Error("AUDIT_NOT_FOUND");
      if (source.action !== "EDIT_TRANSACTION") throw new Error("AUDIT_NOT_REVERSIBLE");
      const metadata = asRecord(source.metadata);
      const state = String(metadata.history_state ?? "applied");
      if (mode === "undo" && state === "undone") throw new Error("ALREADY_UNDONE");
      if (mode === "redo" && state !== "undone") throw new Error("NOT_UNDONE");

      const transactionId = String(metadata.transaction_id ?? "");
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        select: { id: true, beneficiary_id: true, amount: true, type: true, created_at: true, facility_id: true, is_cancelled: true },
      });
      if (!transaction || transaction.is_cancelled) throw new Error("TRANSACTION_CHANGED");

      const from = mode === "undo" ? "new" : "old";
      const to = mode === "undo" ? "old" : "new";
      const expectedAmount = Number(metadata[`${from}_amount`]);
      const targetAmount = Number(metadata[`${to}_amount`]);
      const expectedType = String(metadata[`${from}_type`] ?? "");
      const targetType = String(metadata[`${to}_type`] ?? "") as "MEDICINE" | "SUPPLIES" | "IMPORT";
      const expectedFacility = String(metadata[`${from}_facility_id`] ?? "");
      const targetFacility = String(metadata[`${to}_facility_id`] ?? "");
      const targetDate = new Date(String(metadata[`${to}_date`] ?? ""));
      if (![expectedAmount, targetAmount].every(Number.isFinite) || !targetType || !targetFacility || Number.isNaN(targetDate.getTime())) {
        throw new Error("AUDIT_DATA_INCOMPLETE");
      }
      if (Number(transaction.amount) !== expectedAmount || transaction.type !== expectedType || transaction.facility_id !== expectedFacility) {
        throw new Error("TRANSACTION_CHANGED");
      }

      const locked = await tx.$queryRaw<Array<{ id: string; total_balance: number; remaining_balance: number; status: string }>>`
        SELECT id, total_balance, remaining_balance, status FROM "Beneficiary"
        WHERE id = ${transaction.beneficiary_id} AND deleted_at IS NULL FOR UPDATE
      `;
      const beneficiary = locked[0];
      if (!beneficiary) throw new Error("BENEFICIARY_NOT_FOUND");
      const nextBalance = roundCurrency(Number(beneficiary.remaining_balance) + expectedAmount - targetAmount);
      if (nextBalance < 0 || nextBalance > Number(beneficiary.total_balance)) throw new Error("BALANCE_CONFLICT");
      const nextStatus = beneficiary.status === "SUSPENDED" ? "SUSPENDED" : nextBalance <= 0 ? "FINISHED" : "ACTIVE";

      await tx.transaction.update({
        where: { id: transaction.id },
        data: { amount: targetAmount, type: targetType, created_at: targetDate, facility_id: targetFacility },
      });
      await tx.beneficiary.update({
        where: { id: transaction.beneficiary_id },
        data: { remaining_balance: nextBalance, status: nextStatus },
      });
      const historyAudit = await tx.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: mode === "undo" ? "UNDO_AUDIT_OPERATION" : "REDO_AUDIT_OPERATION",
          metadata: {
            source_audit_log_id: source.id,
            source_action: source.action,
            transaction_id: transaction.id,
            from: { amount: expectedAmount, type: expectedType, facility_id: expectedFacility },
            to: { amount: targetAmount, type: targetType, facility_id: targetFacility },
            balance_after: nextBalance,
          },
        },
        select: { id: true },
      });
      await tx.auditLog.update({
        where: { id: source.id },
        data: { metadata: { ...metadata, history_state: mode === "undo" ? "undone" : "applied", last_history_audit_id: historyAudit.id, last_history_at: new Date().toISOString(), last_history_by: session.username } as Prisma.InputJsonValue },
      });
      await assertBeneficiaryBalanceInvariant(tx, transaction.beneficiary_id, `audit-${mode}`);
      return { historyAuditId: historyAudit.id, state: mode === "undo" ? "undone" : "applied" };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const messages: Record<string, string> = {
      AUDIT_NOT_FOUND: "سجل العملية غير موجود",
      AUDIT_NOT_REVERSIBLE: "هذه العملية لا تدعم التراجع العام الآمن",
      ALREADY_UNDONE: "تم التراجع عن هذه العملية مسبقاً",
      NOT_UNDONE: "لا يمكن الإعادة قبل تنفيذ التراجع",
      TRANSACTION_CHANGED: "تغيرت الحركة بعد هذه العملية؛ أوقف التراجع لحماية البيانات",
      AUDIT_DATA_INCOMPLETE: "السجل القديم لا يحتوي بيانات قبل/بعد كافية",
      BENEFICIARY_NOT_FOUND: "المستفيد غير موجود",
      BALANCE_CONFLICT: "لا يمكن تطبيق الإجراء لأن الرصيد الحالي يتعارض مع الحالة المسجلة",
    };
    return NextResponse.json({ error: messages[code] ?? "تعذر تنفيذ الإجراء بأمان" }, { status: 409 });
  }
}
