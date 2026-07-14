const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // 1. Count beneficiaries with IMPORT transactions
  const importTxStats = await p.$queryRaw`
    SELECT 
      COUNT(DISTINCT t.beneficiary_id)::int AS beneficiaries_with_import,
      COUNT(t.id)::int AS total_import_txs,
      ROUND(SUM(t.amount)::numeric, 2)::float8 AS total_import_amount
    FROM "Transaction" t
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false
  `;
  console.log("=== IMPORT TRANSACTIONS IN DB ===");
  console.log(importTxStats[0]);

  // 2. Count families (base cards) that have import transactions
  const familyImportStats = await p.$queryRaw`
    SELECT
      COUNT(DISTINCT REGEXP_REPLACE(b.card_number, '([A-Z]\d+)$', ''))::int AS families_with_import,
      COUNT(DISTINCT b.id)::int AS members_with_import
    FROM "Transaction" t
    JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false AND b.deleted_at IS NULL
  `;
  console.log("\n=== FAMILY IMPORT STATS ===");
  console.log(familyImportStats[0]);

  // 3. Check beneficiary statuses
  const statusDist = await p.$queryRaw`
    SELECT status, COUNT(*)::int AS cnt
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY status
    ORDER BY cnt DESC
  `;
  console.log("\n=== BENEFICIARY STATUS DISTRIBUTION ===");
  statusDist.forEach((r) => console.log(r.status, ":", r.cnt));

  // 4. Total balances
  const balSums = await p.$queryRaw`
    SELECT
      ROUND(SUM(total_balance)::numeric, 2)::float8 AS sum_total_bal,
      ROUND(SUM(remaining_balance)::numeric, 2)::float8 AS sum_remaining_bal
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
  `;
  console.log("\n=== BALANCE SUMS ===");
  console.log(balSums[0]);

  // 5. Check for duplicate IMPORT transactions per beneficiary
  const dupeImports = await p.$queryRaw`
    SELECT b.card_number, COUNT(t.id)::int AS import_count
    FROM "Transaction" t
    JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false AND b.deleted_at IS NULL
    GROUP BY b.id, b.card_number
    HAVING COUNT(t.id) > 1
    ORDER BY import_count DESC
    LIMIT 10
  `;
  console.log("\n=== BENEFICIARIES WITH >1 IMPORT TX ===");
  console.log("Count:", dupeImports.length);
  dupeImports.forEach((r) =>
    console.log(r.card_number, ":", r.import_count, "txs")
  );

  // 6. Check the archive table
  try {
    const archiveStats = await p.$queryRaw`
      SELECT COUNT(*)::int AS cnt,
        ROUND(SUM(total_balance_from_file::numeric), 2)::float8 AS sum_total,
        ROUND(SUM(used_balance_from_file::numeric), 2)::float8 AS sum_used
      FROM "FamilyImportArchive"
    `;
    console.log("\n=== ARCHIVE TABLE ===");
    console.log(archiveStats[0]);
  } catch {
    console.log("\n=== ARCHIVE TABLE === (not found)");
  }

  // 7. Fractional import amounts in DB
  const fractionalImports = await p.$queryRaw`
    SELECT COUNT(*)::int AS cnt
    FROM "Transaction"
    WHERE type = 'IMPORT' AND is_cancelled = false
      AND ABS(amount - ROUND(amount)) > 0.001
  `;
  console.log("\n=== FRACTIONAL IMPORT AMOUNTS IN DB ===");
  console.log(fractionalImports[0]);

  // 8. Audit log for last imports
  const lastAudits = await p.$queryRaw`
    SELECT id, action, created_at, 
      (metadata->>'totalRows')::int AS total_rows,
      (metadata->>'importedFamilies')::int AS imported_families,
      (metadata->>'updatedFamilies')::int AS updated_families,
      (metadata->>'importedTransactions')::int AS imported_txs,
      (metadata->>'updatedTransactions')::int AS updated_txs,
      (metadata->>'balanceSetFamilies')::int AS balance_set,
      (metadata->>'skippedAlreadyCorrect')::int AS already_correct,
      (metadata->>'suspendedFamilies')::int AS suspended,
      (metadata->>'skippedAlreadySuspended')::int AS already_suspended,
      (metadata->>'skippedNotFound')::int AS not_found,
      (metadata->>'preImportBalanceAdjustedFamilies')::int AS pre_adjust,
      (metadata->>'preImportBalanceAlreadyCorrect')::int AS pre_correct
    FROM "AuditLog"
    WHERE action = 'IMPORT_TRANSACTIONS'
    ORDER BY created_at DESC
    LIMIT 5
  `;
  console.log("\n=== LAST 5 IMPORT AUDIT LOGS ===");
  lastAudits.forEach((r) => console.log(JSON.stringify(r)));

  // 9. Sample: verify a specific family's balances match expected
  const sampleFamily = await p.$queryRaw`
    SELECT 
      b.card_number, b.name, b.status,
      b.total_balance::float8 AS total_balance,
      b.remaining_balance::float8 AS remaining_balance,
      COALESCE(SUM(CASE WHEN t.type = 'IMPORT' THEN t.amount ELSE 0 END)::float8, 0) AS import_deducted,
      COALESCE(SUM(CASE WHEN t.type != 'IMPORT' AND t.type != 'CANCELLATION' THEN t.amount ELSE 0 END)::float8, 0) AS manual_deducted
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id AND t.is_cancelled = false
    WHERE b.card_number LIKE 'WAB20253876%' AND b.deleted_at IS NULL
    GROUP BY b.id
    ORDER BY b.card_number
  `;
  console.log("\n=== SAMPLE FAMILY: WAB20253876 (file: total=1800, used=657, fam=3) ===");
  sampleFamily.forEach((r) => console.log(JSON.stringify(r)));

  // 10. Check balance correctness: remaining = total - all_deductions
  const driftCheck = await p.$queryRaw`
    SELECT COUNT(*)::int AS drift_count
    FROM (
      SELECT 
        b.id,
        b.remaining_balance::float8 AS stored_remaining,
        (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0)) AS computed_remaining
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id AND t.is_cancelled = false AND t.type != 'CANCELLATION'
      WHERE b.deleted_at IS NULL
      GROUP BY b.id
      HAVING ABS(b.remaining_balance::float8 - (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) > 0.01
    ) sub
  `;
  console.log("\n=== BALANCE DRIFT CHECK ===");
  console.log("Beneficiaries with balance drift:", driftCheck[0].drift_count);

  // 11. Verify total deducted vs file usedBalance
  const totalDeducted = await p.$queryRaw`
    SELECT ROUND(SUM(t.amount)::numeric, 2)::float8 AS total_deducted
    FROM "Transaction" t
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false
  `;
  console.log("\n=== TOTAL IMPORT DEDUCTED VS FILE ===");
  console.log("DB total deducted:", totalDeducted[0].total_deducted);
  console.log("File sum usedBalance: 162034.26");

  // 12. Check the duplicate card WAB2025106232
  const dupeCard = await p.$queryRaw`
    SELECT b.card_number, b.name, b.status,
      b.total_balance::float8 AS total_balance,
      b.remaining_balance::float8 AS remaining_balance
    FROM "Beneficiary" b
    WHERE b.card_number LIKE 'WAB2025106232%' AND b.deleted_at IS NULL
    ORDER BY b.card_number
  `;
  console.log("\n=== DUPLICATE CARD: WAB2025106232 ===");
  dupeCard.forEach((r) => console.log(JSON.stringify(r)));

  // 13. Check how many families have correct totalBalance matching file 
  // (for the 380 IMPORT families)
  const importFamilyBalanceCheck = await p.$queryRaw`
    WITH base_cards AS (
      SELECT DISTINCT REGEXP_REPLACE(b.card_number, '([A-Z]\d+)$', '') AS base_card
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.type = 'IMPORT' AND t.is_cancelled = false AND b.deleted_at IS NULL
    )
    SELECT 
      bc.base_card,
      SUM(b.total_balance)::float8 AS family_total_balance,
      SUM(b.remaining_balance)::float8 AS family_remaining_balance,
      COUNT(b.id)::int AS member_count
    FROM base_cards bc
    JOIN "Beneficiary" b ON b.card_number LIKE (bc.base_card || '%') AND b.deleted_at IS NULL
    GROUP BY bc.base_card
    ORDER BY bc.base_card
    LIMIT 10
  `;
  console.log("\n=== SAMPLE IMPORT FAMILIES (first 10) ===");
  importFamilyBalanceCheck.forEach((r) => console.log(JSON.stringify(r)));

  await p.$disconnect();
}

main().catch(console.error);
