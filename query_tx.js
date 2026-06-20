const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: {
      beneficiary: {
        card_number: 'ARCAD20250002'
      }
    },
    select: {
      id: true,
      created_at: true,
      amount: true
    }
  });
  console.log(txs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
