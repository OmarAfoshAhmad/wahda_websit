const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: { company_id: null },
    include: { beneficiary: true }
  });
  console.log("Remaining transactions with null company_id:", txs);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
