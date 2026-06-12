const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.updateMany({
    where: { remaining_ceiling_after: { gte: 999000000 } },
    data: { remaining_ceiling_after: null }
  });
  console.log('Updated:', txs);
}

main().finally(() => prisma.$disconnect());
