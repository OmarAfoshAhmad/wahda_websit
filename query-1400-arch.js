const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const arch = await prisma.cardNumberingArchive.findMany({
    where: { card_number: { contains: '1400' } }
  });
  console.log(JSON.stringify(arch, null, 2));
}

main().finally(() => prisma.$disconnect());
