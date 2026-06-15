const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const aggs = await prisma.transaction.groupBy({
    by: ['beneficiary_id'],
    where: { type: 'OPTICS', is_cancelled: false },
    _sum: { ceiling_consumed: true }
  });
  
  const matches = aggs.filter(a => a._sum.ceiling_consumed > 1000);
  
  for (const match of matches) {
    const ben = await prisma.beneficiary.findUnique({
      where: { id: match.beneficiary_id }
    });
    console.log(`Beneficiary: ${ben.name} (${ben.card_number}) - Consumption: ${match._sum.ceiling_consumed}`);
  }
}
main().finally(() => prisma.$disconnect());
