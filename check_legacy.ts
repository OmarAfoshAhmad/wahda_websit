const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allCards = await prisma.beneficiary.findMany({ select: { card_number: true, is_legacy_card: true } });
  let unpaddedOld = 0;
  let paddedNew = 0;
  let legacyUnpadded = 0;
  let legacyPadded = 0;
  
  for (const c of allCards) {
    const m = c.card_number.match(/^WAB2025(0*)(\d+)([A-Z]\d+)?$/i);
    if (m) {
      const zeros = m[1];
      if (c.is_legacy_card) {
        if (zeros === '') legacyUnpadded++;
        else legacyPadded++;
      } else {
        if (zeros === '') unpaddedOld++;
        else paddedNew++;
      }
    }
  }
  console.log({ unpaddedOld, paddedNew, legacyUnpadded, legacyPadded });
}

main().catch(console.error).finally(() => prisma.$disconnect());
