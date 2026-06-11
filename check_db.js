const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const archive = await prisma.cardNumberingArchive.findMany({
    where: { employee_number: '11546' }
  });
  console.log("Archive:", archive.map(a => ({ name: a.name, card: a.card_number, rel: a.relationship })));

  const system = await prisma.beneficiary.findMany({
    where: { card_number: { startsWith: 'WAB202511546' } }
  });
  console.log("System:", system.map(b => ({ name: b.name, card: b.card_number })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
