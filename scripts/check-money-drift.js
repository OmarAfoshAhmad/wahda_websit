"use strict";

/**
 * فحص الانجراف المالي الشامل — للقراءة فقط، يُشغَّل ليلياً على الإنتاج.
 * بعد توحيد مصادر الحقيقة يجب أن يطبع صفراً دائماً؛ أي رقم غيره = عطل في مسار كتابة يُكتشف في يومه.
 *
 *   AUDIT_DATABASE_URL="postgresql://..." node scripts/check-money-drift.js
 *   كود الخروج: 0 سليم، 2 يوجد انجراف، 1 فشل الفحص.
 *
 * cron (كل يوم 03:00 بتوقيت الخادم) على السيرفر:
 *   0 3 * * * cd /opt/waad && AUDIT_DATABASE_URL="$PROD_DB_URL" node scripts/check-money-drift.js >> /var/log/waad-money-drift.log 2>&1 || echo "money drift detected" | mail -s "[waad] money drift" ops@example.com
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
const SAMPLE = 10;

const CHECKS = [
  {
    key: "base_balance_drift",
    title: "الرصيد الأساسي المخزَّن ≠ دفتر الحركات",
    sql: `
      WITH ledger AS (
        SELECT beneficiary_id, SUM(COALESCE(actual_company_share, amount)) AS spent
        FROM "Transaction"
        WHERE is_cancelled = false AND type NOT IN ('CANCELLATION','DENTAL','OPTICS','PHYSIOTHERAPY')
        GROUP BY beneficiary_id
      )
      SELECT b.name, b.card_number,
             b.remaining_balance::float8 AS stored,
             (b.total_balance - COALESCE(l.spent, 0))::float8 AS ledger,
             (b.remaining_balance - (b.total_balance - COALESCE(l.spent, 0)))::float8 AS drift
      FROM "Beneficiary" b
      LEFT JOIN ledger l ON l.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
        AND ABS(b.remaining_balance - (b.total_balance - COALESCE(l.spent, 0))) > 0.005
      ORDER BY ABS(b.remaining_balance - (b.total_balance - COALESCE(l.spent, 0))) DESC`,
    line: (r) => `${r.name} | ${r.card_number} | مخزَّن ${fmt(r.stored)} | دفتر ${fmt(r.ledger)} | فرق ${fmt(r.drift)}`,
  },
  {
    key: "overdrawn",
    title: "صرف فوق الرصيد الكلي (رصيد سالب فعلياً)",
    sql: `
      WITH ledger AS (
        SELECT beneficiary_id, SUM(COALESCE(actual_company_share, amount)) AS spent
        FROM "Transaction"
        WHERE is_cancelled = false AND type NOT IN ('CANCELLATION','DENTAL','OPTICS','PHYSIOTHERAPY')
        GROUP BY beneficiary_id
      )
      SELECT b.name, b.card_number, b.total_balance::float8 AS total, l.spent::float8 AS spent,
             (l.spent - b.total_balance)::float8 AS over
      FROM "Beneficiary" b JOIN ledger l ON l.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL AND l.spent > b.total_balance + 0.005
      ORDER BY (l.spent - b.total_balance) DESC`,
    line: (r) => `${r.name} | ${r.card_number} | كلي ${fmt(r.total)} | مصروف ${fmt(r.spent)} | فوق ${fmt(r.over)}`,
  },
  {
    key: "status_mismatch",
    title: "حالة المستفيد لا تطابق رصيده (FINISHED/ACTIVE)",
    sql: `
      SELECT name, card_number, status, remaining_balance::float8 AS remaining
      FROM "Beneficiary"
      WHERE deleted_at IS NULL AND status <> 'SUSPENDED'
        AND ((remaining_balance <= 0 AND status <> 'FINISHED') OR (remaining_balance > 0 AND status <> 'ACTIVE'))
      ORDER BY remaining_balance DESC`,
    line: (r) => `${r.name} | ${r.card_number} | ${r.status} | متبقٍ ${fmt(r.remaining)}`,
  },
  {
    key: "ceiling_overage",
    title: "استهلاك سقف سنوي يتجاوز سقف الخدمة (أسنان/بصريات/علاج طبيعي)",
    sql: `
      WITH consumed AS (
        SELECT t.beneficiary_id, t.type::text AS wallet,
               EXTRACT(YEAR FROM (t.created_at AT TIME ZONE 'Africa/Tripoli'))::int AS fiscal_year,
               SUM(CASE WHEN t.type = 'PHYSIOTHERAPY' THEN t.amount ELSE COALESCE(t.ceiling_consumed, 0) END) AS used
        FROM "Transaction" t
        WHERE t.is_cancelled = false AND t.type IN ('DENTAL','OPTICS','PHYSIOTHERAPY')
        GROUP BY 1, 2, 3
      ),
      ceilings AS (
        SELECT b.id AS beneficiary_id, st.code AS wallet,
               CASE
                 WHEN b.custom_ceilings ? st.code THEN NULLIF(b.custom_ceilings ->> st.code, 'null')::numeric
                 ELSE sp.ceiling_amount
               END AS ceiling,
               (b.custom_ceilings ? st.code AND (b.custom_ceilings ->> st.code) = 'null') AS custom_unlimited
        FROM "Beneficiary" b
        JOIN "ServicePolicy" sp ON sp.company_id = b.company_id
        JOIN "ServiceType" st ON st.id = sp.service_type_id
        WHERE b.deleted_at IS NULL
      )
      SELECT b.name, b.card_number, c.wallet, c.fiscal_year, c.used::float8 AS used, ce.ceiling::float8 AS ceiling,
             (c.used - ce.ceiling)::float8 AS over
      FROM consumed c
      JOIN ceilings ce ON ce.beneficiary_id = c.beneficiary_id AND ce.wallet = c.wallet
      JOIN "Beneficiary" b ON b.id = c.beneficiary_id
      WHERE ce.ceiling IS NOT NULL AND NOT ce.custom_unlimited AND c.used > ce.ceiling + 0.005
      ORDER BY (c.used - ce.ceiling) DESC`,
    line: (r) => `${r.name} | ${r.card_number} | ${r.wallet} ${r.fiscal_year} | مستهلك ${fmt(r.used)} | سقف ${fmt(r.ceiling)} | فوق ${fmt(r.over)}`,
  },
  {
    key: "share_vs_consumed",
    title: "حصة الشركة المسجَّلة ≠ المستهلك من السقف على نفس الحركة",
    sql: `
      SELECT t.id, b.name, b.card_number, t.type::text AS type,
             t.actual_company_share::float8 AS share, t.ceiling_consumed::float8 AS consumed
      FROM "Transaction" t JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.is_cancelled = false AND t.type IN ('DENTAL','OPTICS')
        AND t.actual_company_share IS NOT NULL AND t.ceiling_consumed IS NOT NULL
        AND ABS(t.actual_company_share - t.ceiling_consumed) > 0.005
      ORDER BY ABS(t.actual_company_share - t.ceiling_consumed) DESC`,
    line: (r) => `${r.name} | ${r.card_number} | ${r.type} | حصة ${fmt(r.share)} | مستهلك ${fmt(r.consumed)} | ${r.id}`,
  },
  {
    key: "dangling_cancellations",
    title: "صفوف إلغاء بلا أصل، أو أصل ملغى بلا صف إلغاء",
    sql: `
      SELECT 'cancellation_without_original' AS kind, c.id, b.name, b.card_number
      FROM "Transaction" c JOIN "Beneficiary" b ON b.id = c.beneficiary_id
      WHERE c.type = 'CANCELLATION' AND c.is_cancelled = false
        AND (c.original_transaction_id IS NULL OR NOT EXISTS (SELECT 1 FROM "Transaction" o WHERE o.id = c.original_transaction_id AND o.is_cancelled = true))
      UNION ALL
      SELECT 'cancelled_without_row', o.id, b.name, b.card_number
      FROM "Transaction" o JOIN "Beneficiary" b ON b.id = o.beneficiary_id
      WHERE o.is_cancelled = true AND o.type <> 'CANCELLATION'
        AND NOT EXISTS (SELECT 1 FROM "Transaction" c WHERE c.original_transaction_id = o.id AND c.type = 'CANCELLATION' AND c.is_cancelled = false)`,
    line: (r) => `${r.kind} | ${r.name} | ${r.card_number} | ${r.id}`,
  },
  {
    key: "out_of_range_dates",
    title: "حركات بتاريخ في المستقبل أو قبل 2020",
    sql: `
      SELECT t.id, b.name, b.card_number, t.type::text AS type, t.created_at
      FROM "Transaction" t JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.is_cancelled = false AND (t.created_at > NOW() OR t.created_at < '2020-01-01')
      ORDER BY t.created_at DESC`,
    line: (r) => `${r.name} | ${r.card_number} | ${r.type} | ${new Date(r.created_at).toISOString().slice(0, 10)}`,
  },
];

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: requireAuditUrl(), log: ["error"] });
  const summary = {};
  let anyDrift = false;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      console.log(`\n فحص الانجراف المالي — ${new Date().toISOString()}`);
      console.log("═".repeat(100));
      for (const check of CHECKS) {
        const rows = await tx.$queryRawUnsafe(check.sql);
        summary[check.key] = rows.length;
        const ok = rows.length === 0;
        anyDrift = anyDrift || !ok;
        console.log(`\n ${ok ? "✓" : "✗"} ${check.title}: ${rows.length}`);
        for (const r of rows.slice(0, SAMPLE)) console.log(`     ${check.line(r)}`);
        if (rows.length > SAMPLE) console.log(`     … و ${rows.length - SAMPLE} أخرى`);
      }
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log("\n" + "═".repeat(100));
  console.log(` SUMMARY ${JSON.stringify({ ok: !anyDrift, ...summary })}`);
  console.log(anyDrift ? " ✗ يوجد انجراف — راجع أعلاه.\n" : " ✓ لا انجراف.\n");
  process.exitCode = anyDrift ? 2 : 0;
}

main().catch((error) => {
  console.error("فشل الفحص:", error.message);
  process.exitCode = 1;
});
