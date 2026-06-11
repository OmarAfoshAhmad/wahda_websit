const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ben = await prisma.beneficiary.findUnique({ where: { card_number: 'WAB20258134' } });
  console.log('BENEFICIARY:', ben);
}

main().catch(console.error).finally(() => prisma.$disconnect());
