const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ben = await prisma.beneficiary.findFirst({ where: { card_number: 'WAB20258134' } });
  console.log('8134:', ben ? ben.is_legacy_card : 'NOT FOUND');
  const ben2 = await prisma.beneficiary.findFirst({ where: { card_number: 'WAB202508133' } });
  console.log('8133:', ben2 ? ben2.is_legacy_card : 'NOT FOUND');
}

main().catch(console.error).finally(() => prisma.$disconnect());
