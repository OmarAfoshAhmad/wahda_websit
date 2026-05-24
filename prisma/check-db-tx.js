const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Transaction Counts by Company ===");
  const counts = await prisma.transaction.groupBy({
    by: ['company_id'],
    _count: { id: true }
  });

  const companies = await prisma.insuranceCompany.findMany({
    select: { id: true, name: true, code: true }
  });

  const compMap = new Map(companies.map(c => [c.id, c]));

  counts.forEach((item) => {
    const comp = compMap.get(item.company_id);
    console.log(`Company: ${comp ? `${comp.name} (${comp.code})` : 'NULL / Individual'} | Count: ${item._count.id}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
