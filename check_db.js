
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  try {
    const jsonStr = (obj) => JSON.stringify(obj, (key, value) => typeof value === "bigint" ? value.toString() : value, 2);

    const importStats = await prisma.$queryRaw`
      SELECT 
        COUNT(*)::text as count, 
        COUNT(DISTINCT beneficiary_id)::text as beneficiaries
      FROM "Transaction"
      WHERE type = ${"IMPORT"}::"TransactionType" AND is_cancelled = false
    `;

    const settlementStats = await prisma.$queryRaw`
      SELECT COUNT(*)::text as count
      FROM "Transaction"
      WHERE type = ${"SETTLEMENT"}::"TransactionType"
      AND is_cancelled = false
      AND (
        idempotency_key LIKE ${"DEBT_SETTLE:%"} OR 
        idempotency_key LIKE ${"IMPORT_GAP_SETTLE:%"} OR 
        idempotency_key LIKE ${"%_DEBTOR_CREDIT:%"}
      )
    `;

    const multiImportStats = await prisma.$queryRaw`
      SELECT COUNT(*)::text as count FROM (
        SELECT beneficiary_id
        FROM "Transaction"
        WHERE type = ${"IMPORT"}::"TransactionType" AND is_cancelled = false
        GROUP BY beneficiary_id
        HAVING COUNT(*) > 1
      ) as sub
    `;

    const excessImportStats = await prisma.$queryRaw`
      SELECT COUNT(*)::text as count FROM (
        SELECT t.beneficiary_id
        FROM "Transaction" t
        JOIN "Beneficiary" b ON t.beneficiary_id = b.id
        WHERE t.type = ${"IMPORT"}::"TransactionType" AND t.is_cancelled = false
        GROUP BY t.beneficiary_id, b.total_balance
        HAVING SUM(t.amount) > b.total_balance
      ) as sub
    `;

    const balanceAnomalyStats = await prisma.$queryRaw`
      SELECT COUNT(*)::text as count
      FROM "Beneficiary"
      WHERE remaining_balance < 0 OR remaining_balance > total_balance
    `;

    const familyStats = await prisma.$queryRaw`
      SELECT COUNT(*)::text as count FROM (
        SELECT b1.id
        FROM "Beneficiary" b1, "Beneficiary" b2
        WHERE (b1.card_number LIKE ${"%-M"} AND b2.card_number = b1.card_number || ${"1"})
           OR (b1.card_number LIKE ${"%-F"} AND b2.card_number = b1.card_number || ${"1"})
           OR (b1.card_number LIKE ${"%M"} AND b2.card_number = b1.card_number || ${"1"})
           OR (b1.card_number LIKE ${"%F"} AND b2.card_number = b1.card_number || ${"1"})
      ) as sub
    `;

    // TOP 20 SUSPICIOUS ROWS
    const suspiciousBalance = await prisma.$queryRaw`
      SELECT id, card_number, name, total_balance::text, remaining_balance::text
      FROM "Beneficiary"
      WHERE remaining_balance < 0 OR remaining_balance > total_balance
      LIMIT 20
    `;

    const suspiciousExcessImport = await prisma.$queryRaw`
      SELECT t.beneficiary_id, b.card_number, b.name, b.total_balance::text, SUM(t.amount)::text as total_import
      FROM "Transaction" t
      JOIN "Beneficiary" b ON t.beneficiary_id = b.id
      WHERE t.type = ${"IMPORT"}::"TransactionType" AND t.is_cancelled = false
      GROUP BY t.beneficiary_id, b.card_number, b.name, b.total_balance
      HAVING SUM(t.amount) > b.total_balance
      LIMIT 20
    `;

    const suspiciousMultiImport = await prisma.$queryRaw`
       SELECT t.beneficiary_id, b.card_number, b.name, COUNT(*)::text as import_count
        FROM "Transaction" t
        JOIN "Beneficiary" b ON t.beneficiary_id = b.id
        WHERE t.type = ${"IMPORT"}::"TransactionType" AND t.is_cancelled = false
        GROUP BY t.beneficiary_id, b.card_number, b.name
        HAVING COUNT(*) > 1
        LIMIT 20
    `;

    console.log(jsonStr({
      counts: {
        importStats: importStats[0],
        settlementStats: settlementStats[0],
        multiImportStats: multiImportStats[0],
        excessImportStats: excessImportStats[0],
        balanceAnomalyStats: balanceAnomalyStats[0],
        familyStats: familyStats[0]
      },
      suspicious: {
        balance: suspiciousBalance,
        excessImport: suspiciousExcessImport,
        multiImport: suspiciousMultiImport
      }
    }));

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
check();
