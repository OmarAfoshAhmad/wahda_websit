"use strict";

/**
 * حصر المستفيدين الذين صُرف لهم من الرصيد الأساسي أكثر من رصيدهم الكلي (رصيد سالب فعلياً).
 * كان القصّ عند الصفر يُخفي هؤلاء؛ بعد إزالته يظهر رصيدهم سالباً كما هو.
 * للقراءة فقط.
 *
 *   AUDIT_DATABASE_URL="postgresql://..." node scripts/audit-overdrawn-balances.js
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
      return tx.$queryRawUnsafe(`
        WITH ledger AS (
          SELECT
            t.beneficiary_id,
            SUM(COALESCE(t.actual_company_share, t.amount)) AS spent,
            COUNT(*)::int                                   AS tx_count
          FROM "Transaction" t
          WHERE t.is_cancelled = false
            AND t.type NOT IN ('CANCELLATION', 'DENTAL', 'OPTICS', 'PHYSIOTHERAPY')
          GROUP BY t.beneficiary_id
        )
        SELECT
          b.name,
          b.card_number,
          c.name                                   AS company,
          b.status,
          b.total_balance::float8                  AS total_balance,
          b.remaining_balance::float8              AS stored_remaining,
          l.spent::float8                          AS ledger_spent,
          (b.total_balance - l.spent)::float8      AS ledger_remaining,
          l.tx_count
        FROM "Beneficiary" b
        JOIN ledger l ON l.beneficiary_id = b.id
        LEFT JOIN "InsuranceCompany" c ON c.id = b.company_id
        WHERE b.deleted_at IS NULL
          AND l.spent > b.total_balance + 0.005
        ORDER BY (l.spent - b.total_balance) DESC
      `);
    });

    console.log("\n حصر الصرف فوق الرصيد الأساسي (قراءة فقط)");
    console.log("─".repeat(110));

    if (rows.length === 0) {
      console.log("\n ✓ لا يوجد أي مستفيد صُرف له أكثر من رصيده الكلي.\n");
      return;
    }

    let totalOver = 0;
    for (const r of rows) {
      const over = r.ledger_spent - r.total_balance;
      totalOver += over;
      console.log(
        `  ${String(r.name).slice(0, 26).padEnd(26)} | ${String(r.card_number).padEnd(14)} | ${String(r.company ?? "-").slice(0, 18).padEnd(18)}` +
        ` | ${String(r.status).padEnd(9)} | كلي ${fmt(r.total_balance).padStart(9)} | مصروف ${fmt(r.ledger_spent).padStart(9)}` +
        ` | فوق الرصيد ${fmt(over).padStart(8)} | مخزَّن ${fmt(r.stored_remaining).padStart(8)} | ${r.tx_count} حركة`
      );
    }

    console.log("─".repeat(110));
    console.log(`\n ${rows.length} مستفيد — إجمالي الصرف فوق الرصيد: ${fmt(totalOver)} د.ل.`);
    console.log(" كل صف يحتاج قراراً بشرياً: رفع الرصيد الكلي، أو إلغاء حركة خاطئة، أو اعتماده كدين. لا يُصلَّح آلياً.\n");
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("فشل الحصر:", error.message);
  process.exitCode = 1;
});
