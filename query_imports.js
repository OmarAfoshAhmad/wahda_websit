const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: { idempotency_key: { startsWith: 'import-optics-tx:' } },
    select: { id: true, type: true, beneficiary: { select: { card_number: true } } }
  });
  console.log(`Imported optics txs: ${txs.length}`);
  const counts = txs.reduce((acc, tx) => {
    acc[tx.type] = (acc[tx.type] || 0) + 1;
    return acc;
  }, {});
  console.log('Types:', counts);
}

main().catch(console.error).finally(() => prisma.$disconnect());
