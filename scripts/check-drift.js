const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const rows = await p.$queryRaw`
    SELECT
      b.id,
      b.card_number,
      b.name,
      b.status,
      b.total_balance::float8 AS total_balance,
      b.remaining_balance::float8 AS stored_remaining,
      (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0)) AS computed_remaining,
      ABS(b.remaining_balance::float8 - (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) AS drift
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t
      ON t.beneficiary_id = b.id
      AND t.is_cancelled = false
      AND t.type != 'CANCELLATION'
    WHERE b.deleted_at IS NULL
    GROUP BY b.id
    HAVING ABS(b.remaining_balance::float8 - (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) > 0.01
    ORDER BY drift DESC
  `;

  console.log("count", rows.length);
  rows.forEach((r) => console.log(JSON.stringify(r)));

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
