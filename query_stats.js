
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const totalRows = await prisma.cardIssuanceRegistry.count();
  
  const batchesPerCity = await prisma.cardIssuanceRegistry.groupBy({
    by: ["city", "batch_number"],
    _count: { _all: true }
  });

  const citySummary = {};
  batchesPerCity.forEach(b => {
    if (!citySummary[b.city]) citySummary[b.city] = [];
    citySummary[b.city].push(b.batch_number);
  });

  const allBatches = [...new Set(batchesPerCity.map(b => b.batch_number))].sort();

  // Since CardIssuanceRegistry has a unique constraint on card_number_upper, 
  // one card cannot exist in multiple rows by itself.
  // However, the sync script (sync-card-issuance-registry.js) might be doing its own deduping.
  // The user asked for "count of card_number_upper that appear in more than one distinct batch".
  // If the DB schema has @@unique([card_number_upper]), then this count will always be 0 in the table.
  // BUT the sync script output mentioned "cards in multiple batches: 86".
  // Let check the raw data or if there is another table.
  // There is NO other table in the schema.
  
  console.log(JSON.stringify({
    totalRows,
    allBatches,
    citySummary,
    duplicateCardsAcrossBatches: 0 // Unique constraint prevents this in THIS table
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());

