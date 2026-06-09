const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const nadia = await prisma.beneficiary.findMany({
    where: {
      name: { contains: 'نادية عمران' }
    }
  });
  console.log(JSON.stringify(nadia, null, 2));
}
main().finally(() => prisma.$disconnect());
