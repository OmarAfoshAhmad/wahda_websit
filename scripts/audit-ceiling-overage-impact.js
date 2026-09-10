"use strict";

/**
 * قياس أثر تفعيل "الرفض الصارم لتجاوز السقف" قبل تطبيقه.
 * للقراءة فقط — لا يعدّل أي بيانات.
 *
 * التشغيل:
 *   AUDIT_DATABASE_URL="postgresql://..." node scripts/audit-ceiling-overage-impact.js
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

// نفس شرط الحارس المقترح: الشركة دفعت أقل مما تفرضه نسبة التغطية => السقف قضم الفرق.
const OVERAGE_PREDICATE = `
  t.original_company_share IS NOT NULL
  AND t.actual_company_share IS NOT NULL
  AND t.actual_company_share < t.original_company_share - 0.01
`;

const num = (v) => Number(v ?? 0);
const fmt = (v) => num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: requireAuditUrl(), log: ["error"] });

  try {
    const report = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

      const byYear = await tx.$queryRawUnsafe(`
        SELECT
          EXTRACT(YEAR FROM t.created_at)::int      AS year,
          COUNT(*)::int                             AS total_tx,
          COUNT(*) FILTER (WHERE ${OVERAGE_PREDICATE})::int AS blocked_tx,
          COALESCE(SUM(t.amount) FILTER (WHERE ${OVERAGE_PREDICATE}), 0) AS blocked_amount,
          COALESCE(SUM(t.original_company_share - t.actual_company_share)
                   FILTER (WHERE ${OVERAGE_PREDICATE}), 0) AS overage_amount
        FROM "Transaction" t
        WHERE t.is_cancelled = false
          AND t.type <> 'CANCELLATION'
          AND t.company_id IS NOT NULL
        GROUP BY 1
        ORDER BY 1 DESC
      `);

      const byCategory = await tx.$queryRawUnsafe(`
        SELECT
          COALESCE(t.service_category, t.type::text)  AS category,
          COUNT(*)::int                               AS blocked_tx,
          COUNT(DISTINCT t.beneficiary_id)::int       AS beneficiaries,
          COALESCE(SUM(t.original_company_share - t.actual_company_share), 0) AS overage_amount
        FROM "Transaction" t
        WHERE t.is_cancelled = false
          AND t.type <> 'CANCELLATION'
          AND t.company_id IS NOT NULL
          AND ${OVERAGE_PREDICATE}
        GROUP BY 1
        ORDER BY blocked_tx DESC
      `);

      // تركّز التجاوز في شركة واحدة = مؤشر على سقف مُهيّأ خطأ، لا على سلوك مستخدمين.
      const byCompany = await tx.$queryRawUnsafe(`
        SELECT
          c.name                                      AS company,
          COALESCE(t.service_category, t.type::text)  AS category,
          COUNT(*)::int                               AS blocked_tx,
          COUNT(DISTINCT t.beneficiary_id)::int       AS beneficiaries,
          COALESCE(SUM(t.original_company_share - t.actual_company_share), 0) AS overage_amount
        FROM "Transaction" t
        JOIN "InsuranceCompany" c ON c.id = t.company_id
        WHERE t.is_cancelled = false
          AND t.type <> 'CANCELLATION'
          AND ${OVERAGE_PREDICATE}
        GROUP BY 1, 2
        ORDER BY blocked_tx DESC
        LIMIT 25
      `);

      const physio = await tx.$queryRawUnsafe(`
        SELECT
          EXTRACT(YEAR FROM t.created_at)::int   AS year,
          COUNT(*)::int                          AS total_tx,
          COUNT(*) FILTER (
            WHERE (t.calc_metadata -> 'exceededSessions') IS NOT NULL
              AND (t.calc_metadata ->> 'exceededSessions')::numeric > 0
          )::int                                 AS blocked_tx
        FROM "Transaction" t
        WHERE t.is_cancelled = false
          AND t.type = 'PHYSIOTHERAPY'
        GROUP BY 1
        ORDER BY 1 DESC
      `);

      // سقوف بقيمة صفر: تحجب كل شيء بعد التفعيل. لا بد من تمييزها قبل الإطلاق.
      const zeroCeilings = await tx.$queryRawUnsafe(`
        SELECT c.name AS company, st.code AS service_type, sp.ceiling_amount
        FROM "ServicePolicy" sp
        JOIN "InsuranceCompany" c ON c.id = sp.company_id
        JOIN "ServiceType" st ON st.id = sp.service_type_id
        WHERE sp.ceiling_amount = 0
        ORDER BY c.name
      `);

      return { byYear, byCategory, byCompany, physio, zeroCeilings };
    });

    const line = (n = 78) => console.log("─".repeat(n));

    console.log("\n قياس أثر الرفض الصارم لتجاوز السقف (قراءة فقط)");
    line();

    console.log("\n[1] حسب السنة — الحركات المالية التابعة لشركات:");
    console.log("  السنة |   إجمالي |  سترفض |   النسبة | قيمة الحركات | مقدار التجاوز");
    for (const r of report.byYear) {
      const pct = r.total_tx ? ((r.blocked_tx / r.total_tx) * 100).toFixed(1) : "0.0";
      console.log(
        `  ${r.year} | ${String(r.total_tx).padStart(8)} | ${String(r.blocked_tx).padStart(6)} |` +
        ` ${pct.padStart(7)}% | ${fmt(r.blocked_amount).padStart(12)} | ${fmt(r.overage_amount).padStart(13)}`
      );
    }

    console.log("\n[2] الحركات التي سترفض — حسب نوع الخدمة:");
    if (report.byCategory.length === 0) console.log("  (لا يوجد)");
    for (const r of report.byCategory) {
      console.log(
        `  ${String(r.category).padEnd(22)} | حركات: ${String(r.blocked_tx).padStart(6)}` +
        ` | مستفيدون: ${String(r.beneficiaries).padStart(5)} | تجاوز: ${fmt(r.overage_amount)}`
      );
    }

    console.log("\n[3] أعلى 25 (شركة × خدمة) — تركّز التجاوز يشير لسقف مُهيّأ خطأ:");
    if (report.byCompany.length === 0) console.log("  (لا يوجد)");
    for (const r of report.byCompany) {
      console.log(
        `  ${String(r.company).slice(0, 28).padEnd(28)} | ${String(r.category).padEnd(20)}` +
        ` | ${String(r.blocked_tx).padStart(6)} حركة | ${String(r.beneficiaries).padStart(5)} مستفيد | ${fmt(r.overage_amount)}`
      );
    }

    console.log("\n[4] العلاج الطبيعي (بالجلسات):");
    for (const r of report.physio) {
      const pct = r.total_tx ? ((r.blocked_tx / r.total_tx) * 100).toFixed(1) : "0.0";
      console.log(`  ${r.year} | إجمالي: ${String(r.total_tx).padStart(6)} | سترفض: ${String(r.blocked_tx).padStart(6)} | ${pct}%`);
    }

    console.log("\n[5] سياسات بسقف = 0 (ستحجب كل الحركات بعد التفعيل — راجعها):");
    if (report.zeroCeilings.length === 0) console.log("  (لا يوجد — جيد)");
    for (const r of report.zeroCeilings) {
      console.log(`  ⚠  ${r.company} → ${r.service_type} = ${num(r.ceiling_amount)}`);
    }

    line();
    const currentYear = new Date().getFullYear();
    const cy = report.byYear.find((r) => r.year === currentYear);
    if (cy) {
      const pct = cy.total_tx ? ((cy.blocked_tx / cy.total_tx) * 100).toFixed(1) : "0.0";
      console.log(`\n الخلاصة للسنة الحالية (${currentYear}): ${cy.blocked_tx} من ${cy.total_tx} حركة كانت سترفض (${pct}%).`);
    } else {
      console.log(`\n الخلاصة: لا توجد حركات مسجلة للسنة الحالية (${currentYear}).`);
    }
    console.log("");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("فشل التدقيق:", error.message);
  process.exitCode = 1;
});
