const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.beneficiary.count({
    where: {
      card_number: {
        startsWith: 'WAAD2025',
        mode: 'insensitive'
      }
    }
  });
  console.log(`Number of beneficiaries with card starting with WAAD2025: ${count}`);
  
  const sample = await prisma.beneficiary.findMany({
    where: {
      card_number: {
        startsWith: 'WAAD2025',
        mode: 'insensitive'
      }
    },
    take: 5
  });
  console.log(`Sample:`, sample);
}

main().catch(console.error).finally(() => prisma.$disconnect());
