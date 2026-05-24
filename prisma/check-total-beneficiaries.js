const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.beneficiary.count({
    where: { deleted_at: null }
  });
  console.log("Total active beneficiaries in DB:", count);

  const deletedCount = await prisma.beneficiary.count({
    where: { NOT: { deleted_at: null } }
  });
  console.log("Total deleted beneficiaries in DB:", deletedCount);

  // Group by company
  const groups = await prisma.beneficiary.groupBy({
    by: ['company_id'],
    _count: { id: true }
  });

  const companies = await prisma.insuranceCompany.findMany();
  const compMap = new Map(companies.map(c => [c.id, c]));

  console.log("=== Active Beneficiaries by Company ===");
  groups.forEach(g => {
    const comp = compMap.get(g.company_id);
    console.log(`Company: ${comp ? `${comp.name} (${comp.code})` : 'NULL'} | Count: ${g._count.id}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
