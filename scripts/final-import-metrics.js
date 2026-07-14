const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const duplicateImportBeneficiaries = await p.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM (
      SELECT beneficiary_id
      FROM "Transaction"
      WHERE type='IMPORT' AND is_cancelled=false
      GROUP BY beneficiary_id
      HAVING COUNT(*) > 1
    ) x
  `;

  const balanceDriftOfficial = await p.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM (
      SELECT b.id
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
      GROUP BY b.id, b.total_balance, b.remaining_balance
      HAVING ABS(
        b.remaining_balance - GREATEST(
          0,
          b.total_balance - COALESCE(SUM(CASE WHEN t.is_cancelled=false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)
        )
      ) > 0.01
    ) x
  `;

  const archiveFamilies = await p.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM "FamilyImportArchive"
  `;

  const fractionalImportTxActive = await p.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM "Transaction"
    WHERE type='IMPORT' AND is_cancelled=false
      AND ABS(amount - ROUND(amount)) > 0.001
  `;

  const overdrawnDebts = await p.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM (
      SELECT b.id
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t
        ON t.beneficiary_id = b.id
        AND t.is_cancelled = false
        AND t.type <> 'CANCELLATION'
      WHERE b.deleted_at IS NULL
      GROUP BY b.id, b.total_balance
      HAVING (b.total_balance - COALESCE(SUM(t.amount), 0)) < -0.01
    ) x
  `;

  console.log(JSON.stringify({
    duplicateImportBeneficiaries: duplicateImportBeneficiaries[0].c,
    balanceDriftOfficial: balanceDriftOfficial[0].c,
    archiveFamilies: archiveFamilies[0].c,
    fractionalImportTxActive: fractionalImportTxActive[0].c,
    overdrawnDebts: overdrawnDebts[0].c,
  }, null, 2));

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
