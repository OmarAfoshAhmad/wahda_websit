const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.insuranceCompany.findMany({
    select: { id: true, name: true, code: true }
  });
  console.log(companies);
}

main().catch(console.error).finally(() => prisma.$disconnect());
