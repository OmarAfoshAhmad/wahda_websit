const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const arcadCompany = await prisma.insuranceCompany.findFirst({
    where: { code: 'ARCAD' }
  });
  
  if (!arcadCompany) {
    console.log("ARCAD company not found!");
    return;
  }

  const txs = await prisma.transaction.findMany({
    where: {
      company_id: arcadCompany.id,
      type: 'OPTICS'
    }
  });
  console.log(`Total ARCAD optics txs: ${txs.length}`);
  
  // Also count total transactions by type for ARCAD
  const allTxs = await prisma.transaction.groupBy({
    by: ['type'],
    where: { company_id: arcadCompany.id },
    _count: true
  });
  console.log("ARCAD Txs by type:", allTxs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
