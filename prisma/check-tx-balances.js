const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Checking JMR Beneficiaries and Transaction Balances ===");
  // Find beneficiaries of JMR who have transactions
  const jmrBens = await prisma.beneficiary.findMany({
    where: {
      company: { code: "JMR" },
      transactions: { some: {} }
    },
    include: { transactions: true },
    take: 5
  });

  for (const ben of jmrBens) {
    const txSum = ben.transactions.reduce((acc, tx) => acc + (tx.amount || 0), 0);
    const companyShareSum = ben.transactions.reduce((acc, tx) => acc + (Number(tx.actual_company_share || tx.original_company_share || 0)), 0);
    console.log(`Ben: ${ben.name} (${ben.card_number})`);
    console.log(`  Total Balance: ${ben.total_balance}`);
    console.log(`  Remaining Balance: ${ben.remaining_balance}`);
    console.log(`  Transactions count: ${ben.transactions.length}`);
    console.log(`  Sum of Tx amounts: ${txSum}`);
    console.log(`  Sum of company shares: ${companyShareSum}`);
  }

  console.log("\n=== Checking LCC Beneficiaries and Transaction Balances ===");
  const lccBens = await prisma.beneficiary.findMany({
    where: {
      company: { code: "LCC" },
      transactions: { some: {} }
    },
    include: { transactions: true },
    take: 5
  });

  for (const ben of lccBens) {
    const txSum = ben.transactions.reduce((acc, tx) => acc + (tx.amount || 0), 0);
    const companyShareSum = ben.transactions.reduce((acc, tx) => acc + (Number(tx.actual_company_share || tx.original_company_share || 0)), 0);
    console.log(`Ben: ${ben.name} (${ben.card_number})`);
    console.log(`  Total Balance: ${ben.total_balance}`);
    console.log(`  Remaining Balance: ${ben.remaining_balance}`);
    console.log(`  Transactions count: ${ben.transactions.length}`);
    console.log(`  Sum of Tx amounts: ${txSum}`);
    console.log(`  Sum of company shares: ${companyShareSum}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
