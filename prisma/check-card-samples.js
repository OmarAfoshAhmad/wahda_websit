const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.insuranceCompany.findMany({
    where: { code: { in: ["JMR", "LCC"] } }
  });

  for (const c of companies) {
    console.log(`\n=== Samples for ${c.name} (${c.code}) ===`);
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { company_id: c.id, deleted_at: null },
      take: 5,
      select: { card_number: true, name: true }
    });
    console.log(JSON.stringify(beneficiaries, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
