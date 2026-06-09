const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const archive = await prisma.cardNumberingArchive.findMany({
    where: {
      employee_number: {
        contains: '4052',
        mode: 'insensitive'
      }
    }
  });
  console.log("Archive for 4052:", JSON.stringify(archive, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
