const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: {
      beneficiary: { card_number: { startsWith: 'ARCAD20250025' } }
    }
  });
  console.log('Txs count:', txs.length);
  console.log(txs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
