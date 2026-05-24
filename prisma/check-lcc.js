const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const company = await prisma.insuranceCompany.findFirst({
    where: { code: "LCC" }
  });
  console.log("LCC Company Details:", company);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
