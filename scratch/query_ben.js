const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ben = await prisma.beneficiary.findFirst({
    where: { name: { contains: 'رجب الصقر' } }
  });
  console.log("Beneficiary:", ben);
  
  if (!ben) return;

  const txs = await prisma.transaction.findMany({
    where: { beneficiary_id: ben.id }
  });
  console.log("Transactions:", txs);

  const wallet = await prisma.walletConsumption.findMany({
    where: { beneficiary_id: ben.id }
  });
  console.log("Wallet Consumption:", wallet);
}

main().finally(() => prisma.$disconnect());
