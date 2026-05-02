const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const model = prisma.cardIssuanceRegistry;
  const total = await model.count();
  const nullCount = await model.count({ where: { batch_number: null } });
  const underscoreCount = await model.count({ where: { batch_number: "_" } });
  
  // Get top 20 batches with count
  const batches = await prisma.$queryRaw`
    SELECT batch_number, COUNT(*) as count 
    FROM "CardIssuanceRegistry" 
    GROUP BY batch_number 
    ORDER BY count DESC 
    LIMIT 20
  `;
  
  console.log("Success: Card Issuance Sync completed.");
  console.log("Total Rows:", total);
  console.log("Top Batches:", JSON.stringify(batches, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2));
  console.log("Underscore Count:", underscoreCount);
  console.log("Null Count:", nullCount);
}
main().catch(console.error).finally(() => prisma.$disconnect());
