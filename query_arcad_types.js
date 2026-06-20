const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const arcadCompany = await prisma.insuranceCompany.findUnique({
    where: { id: 'cmpdvnz36000fu9t0q042zymw' }
  });
  
  if (!arcadCompany) {
    console.log("ARCAD company not found!");
    return;
  }

  const allTxs = await prisma.transaction.groupBy({
    by: ['type'],
    where: { company_id: arcadCompany.id },
    _count: true
  });
  console.log("ARCAD Txs by type:", allTxs);
  
  const allTxsTotal = await prisma.transaction.count({
    where: { company_id: arcadCompany.id }
  });
  console.log("Total ARCAD txs:", allTxsTotal);
}

main().catch(console.error).finally(() => prisma.$disconnect());
