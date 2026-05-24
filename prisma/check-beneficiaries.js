const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Beneficiary Counts by Company ===");
  const counts = await prisma.beneficiary.groupBy({
    by: ['company_id'],
    _count: { id: true },
    where: { deleted_at: null }
  });

  const companies = await prisma.insuranceCompany.findMany({
    select: { id: true, name: true, code: true }
  });

  const compMap = new Map(companies.map(c => [c.id, c]));

  counts.forEach((item) => {
    const comp = compMap.get(item.company_id);
    console.log(`Company: ${comp ? `${comp.name} (${comp.code})` : 'NULL / Individual'} | Count: ${item._count.id}`);
  });

  // Check JMR sample cards in DB
  const jmrBens = await prisma.beneficiary.findMany({
    where: { company_id: 'cmpgpi50z000uu9h4fh82k1ha', deleted_at: null },
    take: 5,
    select: { id: true, card_number: true, name: true }
  });
  console.log("\n=== Sample JMR Beneficiaries in DB ===");
  console.log(JSON.stringify(jmrBens, null, 2));

  // Check LCC sample cards in DB
  const lccBens = await prisma.beneficiary.findMany({
    where: { company_id: 'cmpgpi516000xu9h4b2zpk92x', deleted_at: null },
    take: 5,
    select: { id: true, card_number: true, name: true }
  });
  console.log("\n=== Sample LCC Beneficiaries in DB ===");
  console.log(JSON.stringify(lccBens, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
