
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.cardNumberingArchive.count();
  const sample = await prisma.cardNumberingArchive.findMany({ take: 5 });
  console.log('Total Archive Items:', count);
  console.log('Sample Items:', JSON.stringify(sample, null, 2));
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
