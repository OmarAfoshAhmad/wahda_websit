const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    take: 20,
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      type: true,
      amount: true,
      created_at: true,
      facility: {
        select: {
          name: true,
          username: true,
        }
      },
      beneficiary: {
        select: {
          name: true,
          card_number: true,
          company: {
            select: {
              name: true
            }
          }
        }
      }
    }
  });

  console.log("=== Recent Transactions ===");
  console.log(JSON.stringify(txs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
