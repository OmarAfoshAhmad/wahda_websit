const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const fs = require('fs');

async function check() {
  const card = 'WAB2025000151W1';
  const results = {};

  results.beneficiary = await prisma.beneficiary.findFirst({
    where: { card_number: { equals: card, mode: 'insensitive' } }
  });

  results.archive = await prisma.cardNumberingArchive.findMany({
    where: { card_number: { equals: card, mode: 'insensitive' } }
  });

  fs.writeFileSync('scratch/output.json', JSON.stringify(results, null, 2));
  await prisma.$disconnect();
}

check();
