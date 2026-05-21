const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.transaction.count({
    where: { type: 'DENTAL' }
  });
  
  console.log(`Total dental transactions in DB: ${count}`);
  
  if (count > 0) {
    const sample = await prisma.transaction.findMany({
      where: { type: 'DENTAL' },
      take: 5,
      include: {
        beneficiary: { select: { name: true, card_number: true } },
        facility: { select: { name: true } }
      },
      orderBy: { created_at: 'desc' }
    });
    
    console.log(`Sample transactions:`);
    sample.forEach(t => {
      console.log(`  - Row: ID: ${t.id} | Beneficiary: "${t.beneficiary.name}" (${t.beneficiary.card_number}) | Facility: "${t.facility.name}" | Amount: ${t.amount} | Date: ${t.created_at}`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
