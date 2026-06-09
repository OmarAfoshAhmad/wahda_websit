const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const isFacility = false;
  const transactionFilter = { is_cancelled: false, service_category: "DENTAL" };
  if (isFacility) {
    transactionFilter.facility_id = "test";
  }

  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          beneficiaries: {
            where: { deleted_at: null, status: "ACTIVE" },
          },
          transactions: {
            where: transactionFilter,
          },
        },
      },
    },
  });
  console.log("Success:", companies.length);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
