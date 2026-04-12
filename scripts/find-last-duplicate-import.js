const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const activeRows = await prisma.$queryRaw`
    SELECT beneficiary_id, COUNT(*)::int as cnt
    FROM "Transaction"
    WHERE type = 'IMPORT' AND is_cancelled = false
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  `;

  const allRows = await prisma.$queryRaw`
    SELECT beneficiary_id, COUNT(*)::int as cnt
    FROM "Transaction"
    WHERE type = 'IMPORT'
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  `;

  console.log('Active duplicate beneficiaries:', activeRows.length);
  console.log('All duplicate beneficiaries (including cancelled):', allRows.length);

  if (allRows.length === 0) {
    console.log('No duplicates in all import transactions');
    await prisma.$disconnect();
    return;
  }

  const id = allRows[0].beneficiary_id;
  const b = await prisma.beneficiary.findUnique({
    where: { id },
    select: { id: true, name: true, card_number: true, remaining_balance: true, status: true },
  });

  const txs = await prisma.transaction.findMany({
    where: { beneficiary_id: id, type: 'IMPORT' },
    orderBy: { created_at: 'asc' },
    select: { id: true, amount: true, created_at: true, facility_id: true, is_cancelled: true },
  });

  console.log(JSON.stringify({ duplicateCount: allRows.length, beneficiary: b, transactions: txs }, null, 2));
  await prisma.$disconnect();
})();
