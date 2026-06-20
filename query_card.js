const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: {
      beneficiary: {
        card_number: { contains: 'ARCAD20250025M1' }
      }
    },
    select: {
      id: true,
      created_at: true,
      amount: true,
      type: true,
      is_cancelled: true,
      beneficiary: { select: { card_number: true } }
    }
  });
  console.log(`Txs for ARCAD20250025M1: ${txs.length}`);
  console.log(txs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
