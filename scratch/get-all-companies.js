const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.insuranceCompany.findMany({
    orderBy: { created_at: "desc" }
  });
  console.log("Existing Companies:", JSON.stringify(companies, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
