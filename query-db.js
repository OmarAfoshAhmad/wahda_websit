const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const laith = await prisma.beneficiary.findMany({
    where: {
      card_number: {
        contains: '104400',
        mode: 'insensitive'
      }
    }
  });
  console.log("Found:", JSON.stringify(laith, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
