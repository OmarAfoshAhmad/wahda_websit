const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const model = prisma.cardIssuanceRegistry;
  const sample = await model.findMany({
    take: 10,
    select: { source_file: true, batch_number: true }
  });
  console.log("Sample rows (file and batch):", JSON.stringify(sample, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
