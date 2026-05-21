const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const samples = await prisma.beneficiary.findMany({
    take: 100,
    select: {
      card_number: true,
      name: true,
      company: { select: { name: true, code: true } }
    }
  });
  console.log('Sample Card Numbers in DB:');
  console.log(samples.map(s => `${s.card_number} | ${s.name} | ${s.company ? s.company.name : 'None'}`).slice(0, 30));
}

main().catch(console.error).finally(() => prisma.$disconnect());
