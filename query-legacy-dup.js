const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const legacyCards = await prisma.beneficiary.findMany({
    where: { is_legacy_card: true, deleted_at: null }
  });

  const allNames = legacyCards.map(c => c.name);

  const newCards = await prisma.beneficiary.findMany({
    where: {
      name: { in: allNames },
      is_legacy_card: false,
      deleted_at: null
    }
  });

  console.log(`Found ${legacyCards.length} legacy cards.`);
  console.log(`Found ${newCards.length} new cards that match names of legacy cards.`);

  if (newCards.length > 0) {
    const examples = newCards.slice(0, 5).map(nc => {
      const lc = legacyCards.find(c => c.name === nc.name);
      return {
        name: nc.name,
        legacy_card: lc.card_number,
        new_card: nc.card_number,
        legacy_date: lc.created_at,
        new_date: nc.created_at,
        batch: nc.batch_number
      };
    });
    console.log("Examples:");
    console.log(JSON.stringify(examples, null, 2));
  }
}

main().finally(() => prisma.$disconnect());
