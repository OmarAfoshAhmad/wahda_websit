const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    where: { company_id: null },
    take: 10,
    include: {
      beneficiary: {
        select: {
          id: true,
          card_number: true,
          name: true,
          company_id: true,
          company: { select: { name: true, code: true } }
        }
      }
    }
  });

  console.log("=== First 10 Transactions with NULL company_id ===");
  console.log(JSON.stringify(txs, null, 2));

  const totalNull = await prisma.transaction.count({
    where: { company_id: null }
  });
  console.log("Total NULL company_id transactions:", totalNull);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
