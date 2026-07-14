const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // 1. How many total IMPORT_TRANSACTIONS audit events exist?
  const auditCount = await p.$queryRaw`
    SELECT COUNT(*)::int AS cnt FROM "AuditLog" WHERE action = 'IMPORT_TRANSACTIONS'
  `;
  console.log("=== TOTAL IMPORT AUDIT EVENTS ===", auditCount[0].cnt);

  // 2. For THIS file (totalRows=829), how many times was it imported?
  const thisFileAudits = await p.$queryRaw`
    SELECT id, created_at,
      (metadata->>'totalRows')::int AS total_rows,
      (metadata->>'importedFamilies')::int AS imported,
      (metadata->>'updatedFamilies')::int AS updated
    FROM "AuditLog"
    WHERE action = 'IMPORT_TRANSACTIONS' AND (metadata->>'totalRows')::int = 829
    ORDER BY created_at ASC
  `;
  console.log("\n=== THIS FILE (829 rows) IMPORT HISTORY ===");
  thisFileAudits.forEach((r) => console.log(JSON.stringify(r)));

  // 3. Verify WAB20253876 family (expected: total=1800 from file, used=657, 3 members)
  // The family has 3 members. File says fam=3. But we need to check if file's
  // card actually resolves to 3 members in DB.
  const family3876 = await p.$queryRaw`
    SELECT b.card_number, b.name, b.status,
      b.total_balance::float8 AS total_balance,
      b.remaining_balance::float8 AS remaining_balance
    FROM "Beneficiary" b
    WHERE b.card_number LIKE 'WAB20253876%' AND b.deleted_at IS NULL
    ORDER BY b.card_number
  `;
  console.log("\n=== WAB20253876 FAMILY IN DB ===");
  family3876.forEach((r) => console.log(JSON.stringify(r)));
  console.log("Expected: total_balance per member=600 each (1800/3), remaining=1800-657=1143 total");
  console.log("Actual total:", family3876.reduce((s, r) => s + r.total_balance, 0));
  console.log("Actual remaining:", family3876.reduce((s, r) => s + r.remaining_balance, 0));

  // 4. The BIG question: if only 1 base card exists (no suffixes), 
  // what is remaining_balance? Should be total - used = 1800 - 657 = 1143
  // But check if member count matched
  const singleMemberFamilies = await p.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM "Beneficiary" b1
    WHERE b1.deleted_at IS NULL
      AND b1.card_number ~ '^WAB2025\\d+$'
      AND NOT EXISTS (
        SELECT 1 FROM "Beneficiary" b2 
        WHERE b2.deleted_at IS NULL 
          AND b2.card_number LIKE (b1.card_number || '%')
          AND b2.id != b1.id
      )
  `;
  console.log("\n=== SINGLE-MEMBER FAMILIES (base card only) ===");
  console.log(singleMemberFamilies[0]);

  // 5. Check the 30 balance drifts - sample them
  const driftSamples = await p.$queryRaw`
    SELECT b.card_number, b.name,
      b.total_balance::float8 AS total_bal,
      b.remaining_balance::float8 AS stored_remaining,
      (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0)) AS computed_remaining,
      ABS(b.remaining_balance::float8 - (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) AS drift
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id AND t.is_cancelled = false AND t.type != 'CANCELLATION'
    WHERE b.deleted_at IS NULL
    GROUP BY b.id
    HAVING ABS(b.remaining_balance::float8 - (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) > 0.01
    ORDER BY drift DESC
    LIMIT 15
  `;
  console.log("\n=== BALANCE DRIFT SAMPLES (top 15) ===");
  driftSamples.forEach((r) => console.log(JSON.stringify(r)));

  // 6. Verify rounding: for families with import, is the per-member deduction integer?
  const nonIntegerDeductions = await p.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM "Transaction" t
    JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false AND b.deleted_at IS NULL
      AND ABS(t.amount - ROUND(t.amount)) > 0.001
  `;
  console.log("\n=== NON-INTEGER IMPORT DEDUCTIONS ===");
  console.log("Count:", nonIntegerDeductions[0].cnt, "(these are from older imports before integer fix)");

  // 7. For THIS file's 380 IMPORT families, verify integer deductions
  // The file has 380 rows with usedBalance > 0. After the latest import,
  // those families should have integer import deductions.
  // Sample a few to check
  const sampleIntCheck = await p.$queryRaw`
    SELECT b.card_number,
      t.amount::float8 AS import_amount,
      ABS(t.amount - ROUND(t.amount)) > 0.001 AS is_fractional
    FROM "Transaction" t
    JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false AND b.deleted_at IS NULL
      AND REGEXP_REPLACE(b.card_number, '([A-Z]\d+)$', '') IN ('WAB20253876', 'WAB20259436', 'WAB20259559')
    ORDER BY b.card_number
  `;
  console.log("\n=== SAMPLE INTEGER CHECK for file families ===");
  sampleIntCheck.forEach((r) => console.log(JSON.stringify(r)));

  // 8. Total count of families with integer vs fractional imports
  const intVsFrac = await p.$queryRaw`
    SELECT 
      COUNT(*) FILTER (WHERE ABS(t.amount - ROUND(t.amount)) <= 0.001)::int AS integer_txs,
      COUNT(*) FILTER (WHERE ABS(t.amount - ROUND(t.amount)) > 0.001)::int AS fractional_txs
    FROM "Transaction" t
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false
  `;
  console.log("\n=== INTEGER vs FRACTIONAL IMPORT TXS ===");
  console.log(intVsFrac[0]);

  await p.$disconnect();
}

main().catch(console.error);
