const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const model = prisma.cardIssuanceRegistry;
  const batches = await model.groupBy({
    by: ["batch_number"],
    _count: { _all: true },
    orderBy: { _count: { batch_number: "desc" } },
    take: 20
  });
  const underscore = await model.count({ where: { batch_number: "_" } });
  const nulls = await model.count({ where: { batch_number: null } });
  const total = await model.count();
  console.log("Total Rows:", total);
  console.log("Top Batches:", JSON.stringify(batches, null, 2));
  console.log("Underscore Count:", underscore);
  console.log("Null Count:", nulls);
}
main().catch(console.error).finally(() => prisma.$disconnect());
