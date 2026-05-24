const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.insuranceCompany.findMany({
    select: { id: true, name: true, code: true, card_pattern: true }
  });
  console.log("=== Company Card Patterns ===");
  console.log(JSON.stringify(companies, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
