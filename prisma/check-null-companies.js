const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const nullCompanyBenCount = await prisma.beneficiary.count({
    where: { company_id: null }
  });
  console.log(`Beneficiaries with company_id = null: ${nullCompanyBenCount}`);

  const nullCompanyTxCount = await prisma.transaction.count({
    where: { company_id: null }
  });
  console.log(`Transactions with company_id = null: ${nullCompanyTxCount}`);

  const totalBens = await prisma.beneficiary.count();
  console.log(`Total Beneficiaries: ${totalBens}`);

  const totalTxs = await prisma.transaction.count();
  console.log(`Total Transactions: ${totalTxs}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
