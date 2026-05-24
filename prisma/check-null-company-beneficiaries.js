const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Beneficiaries with NULL Company ===");
  const count = await prisma.beneficiary.count({
    where: { company_id: null, deleted_at: null }
  });
  console.log(`Total count: ${count}`);

  const samples = await prisma.beneficiary.findMany({
    where: { company_id: null, deleted_at: null },
    take: 30,
    select: { card_number: true, name: true, created_at: true }
  });
  console.log("Samples (first 30):");
  console.log(JSON.stringify(samples, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
