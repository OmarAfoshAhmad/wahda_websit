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

  const cancelled = await prisma.transaction.count({
    where: {
      company_id: arcadCompany.id,
      type: 'OPTICS',
      is_cancelled: true
    }
  });
  console.log(`Cancelled ARCAD optics txs: ${cancelled}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
