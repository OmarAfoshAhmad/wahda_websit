const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.cardNumberingItem.findMany({
    where: {
      employee_number: { contains: '4052' }
    }
  });
  console.log(JSON.stringify(items, null, 2));
}
main().finally(() => prisma.$disconnect());
