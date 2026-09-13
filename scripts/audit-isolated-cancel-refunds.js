"use strict";

/**
 * حصر المستفيدين الذين نُفخ رصيدهم الأساسي بإلغاء حركة بصريات/علاج طبيعي
 * (عطل أُصلح في 3ff3511: الإلغاء كان يرد المبلغ إلى رصيد لم يُخصم منه).
 * للقراءة فقط. التصحيح يتم بأداة «إصلاح انحراف الأرصدة» في صحة البيانات.
 *
 *   AUDIT_DATABASE_URL="postgresql://..." node scripts/audit-isolated-cancel-refunds.js
 */

function requireAuditUrl() {
  const value = process.env.AUDIT_DATABASE_URL;
  if (!value) {
    throw new Error("AUDIT_DATABASE_URL is required; DATABASE_URL is intentionally ignored.");
  }
  const parsed = new URL(value);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("AUDIT_DATABASE_URL must be a PostgreSQL URL.");
  }
  return value;
}

const fmt = (v) => Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: requireAuditUrl(), log: ["error"] });

  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      // الدليل: سجل إلغاء لحركة معزولة رفع الرصيد فعلياً (balance_after > balance_before).
      // الانحراف الحالي: الفرق بين الرصيد المخزَّن والرصيد المحسوب من دفتر الرصيد الأساسي.
      return tx.$queryRawUnsafe(`
        WITH bad_cancels AS (
          SELECT
            a.created_at                                    AS cancelled_at,
            a.user                                          AS by_user,
            t.id                                            AS transaction_id,
            t.type::text                                    AS type,
            t.beneficiary_id,
            (a.metadata->>'balance_before')::numeric        AS balance_before,
            (a.metadata->>'balance_after')::numeric         AS balance_after
          FROM "AuditLog" a
          JOIN "Transaction" t ON t.id = a.metadata->>'original_transaction_id'
          WHERE a.action = 'CANCEL_TRANSACTION'
            AND t.type IN ('OPTICS', 'PHYSIOTHERAPY')
            AND (a.metadata->>'balance_after')::numeric > (a.metadata->>'balance_before')::numeric
        ),
        ledger AS (
          SELECT
            t.beneficiary_id,
            COALESCE(SUM(COALESCE(t.actual_company_share, t.amount)), 0) AS spent
          FROM "Transaction" t
          WHERE t.is_cancelled = false
            AND t.type NOT IN ('CANCELLATION', 'DENTAL', 'OPTICS', 'PHYSIOTHERAPY')
          GROUP BY t.beneficiary_id
        )
        SELECT
          b.name,
          b.card_number,
          c.name                                            AS company,
          bc.type,
          bc.cancelled_at,
          bc.by_user,
          bc.balance_before,
          bc.balance_after,
          (bc.balance_after - bc.balance_before)            AS inflated_by,
          b.remaining_balance                               AS stored_now,
          GREATEST(0, b.total_balance - COALESCE(l.spent, 0)) AS ledger_now,
          (b.remaining_balance - GREATEST(0, b.total_balance - COALESCE(l.spent, 0))) AS drift_now
        FROM bad_cancels bc
        JOIN "Beneficiary" b ON b.id = bc.beneficiary_id
        LEFT JOIN "InsuranceCompany" c ON c.id = b.company_id
        LEFT JOIN ledger l ON l.beneficiary_id = b.id
        ORDER BY drift_now DESC, bc.cancelled_at DESC
      `);
    });

    console.log("\n حصر أرصدة منفوخة بإلغاء حركات بصريات/علاج طبيعي (قراءة فقط)");
    console.log("─".repeat(100));

    if (rows.length === 0) {
      console.log("\n ✓ لا يوجد أي إلغاء لحركة معزولة رفع الرصيد الأساسي. لا شيء يحتاج تصحيحاً.\n");
      return;
    }

    let stillDrifted = 0;
    for (const r of rows) {
      const drift = Number(r.drift_now);
      const flag = drift > 0.01 ? "⚠ ما زال منفوخاً" : "✓ صُحِّح لاحقاً";
      if (drift > 0.01) stillDrifted++;
      console.log(
        `  ${String(r.name).slice(0, 26).padEnd(26)} | ${String(r.card_number).padEnd(14)} | ${String(r.company ?? "-").slice(0, 18).padEnd(18)}` +
        ` | ${String(r.type).padEnd(13)} | ${new Date(r.cancelled_at).toISOString().slice(0, 10)}` +
        ` | نُفخ بـ ${fmt(r.inflated_by).padStart(9)} | مخزَّن ${fmt(r.stored_now).padStart(9)} | دفتر ${fmt(r.ledger_now).padStart(9)} | ${flag}`
      );
    }

    console.log("─".repeat(100));
    console.log(`\n الإجمالي: ${rows.length} إلغاء مؤثر — ${stillDrifted} مستفيد ما زال رصيده منفوخاً الآن.`);
    if (stillDrifted > 0) {
      console.log(" التصحيح: صحة البيانات ← «إصلاح انحراف الأرصدة» (يعيد الحساب من الدفتر مستثنياً الخدمات المعزولة).\n");
    } else {
      console.log(" لا حاجة لأي تصحيح.\n");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("فشل الحصر:", error.message);
  process.exitCode = 1;
});
