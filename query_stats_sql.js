
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const totalRows = await prisma.$queryRaw`SELECT COUNT(*) FROM "CardIssuanceRegistryAll"`;
  
  const batches = await prisma.$queryRaw`
    SELECT city, batch_number, COUNT(*) as count 
    FROM "CardIssuanceRegistryAll" 
    GROUP BY city, batch_number
    ORDER BY city, batch_number
  `;

  const distinctBatchesCount = await prisma.$queryRaw`SELECT COUNT(DISTINCT batch_number) FROM "CardIssuanceRegistryAll"`;

  const duplicatesAcrossBatches = await prisma.$queryRaw`
    SELECT COUNT(*) FROM (
      SELECT card_number_upper 
      FROM "CardIssuanceRegistryAll" 
      GROUP BY card_number_upper 
      HAVING COUNT(DISTINCT batch_number) > 1
    ) AS sub
  `;

  console.log(JSON.stringify({
    totalRows: Number(totalRows[0].count),
    distinctBatchesCount: Number(distinctBatchesCount[0].count),
    batches: batches.map(b => ({ ...b, count: Number(b.count) })),
    duplicateCardsAcrossBatches: Number(duplicatesAcrossBatches[0].count)
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());

