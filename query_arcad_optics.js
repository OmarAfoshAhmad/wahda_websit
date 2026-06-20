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

  const txs = await prisma.transaction.findMany({
    where: {
      company_id: arcadCompany.id,
      type: 'OPTICS'
    },
    select: {
      id: true,
      created_at: true,
      amount: true,
      is_cancelled: true
    }
  });
  console.log(`Total ARCAD optics txs: ${txs.length}`);
  console.log(txs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
