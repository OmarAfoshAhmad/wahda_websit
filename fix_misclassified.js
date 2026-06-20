const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const arcadCompany = await prisma.insuranceCompany.findFirst({
    where: { code: 'ARCD' }
  });
  
  if (!arcadCompany) return;

  const count = await prisma.transaction.count({
    where: { company_id: arcadCompany.id, type: 'MEDICINE', service_category: 'OPTICS' }
  });
  console.log(`Misclassified ARCD optics txs: ${count}`);

  const update = await prisma.transaction.updateMany({
    where: { company_id: arcadCompany.id, type: 'MEDICINE', service_category: 'OPTICS' },
    data: { type: 'OPTICS' }
  });
  console.log(`Updated: ${update.count}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
