const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const archive = await prisma.cardNumberingArchive.findMany({
    where: {
      card_number: {
        contains: '104400',
        mode: 'insensitive'
      }
    }
  });
  console.log("Archive:", JSON.stringify(archive, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
