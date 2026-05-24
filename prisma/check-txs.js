const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.insuranceCompany.findMany({
    select: { id: true, name: true, code: true }
  });

  console.log("=== Transaction Counts per Company ===");
  for (const c of companies) {
    const count = await prisma.transaction.count({
      where: { company_id: c.id }
    });
    const dentalCount = await prisma.transaction.count({
      where: { company_id: c.id, type: "DENTAL" }
    });
    console.log(`- ${c.name} (${c.code}): Total Txs = ${count}, Dental Txs = ${dentalCount}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
