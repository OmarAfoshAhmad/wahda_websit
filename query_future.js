const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: {
      created_at: {
        gt: new Date()
      }
    },
    select: {
      id: true,
      created_at: true
    }
  });
  console.log('Future txs:', txs.length);
  console.log(txs.slice(0, 5));
}

main().catch(console.error).finally(() => prisma.$disconnect());
