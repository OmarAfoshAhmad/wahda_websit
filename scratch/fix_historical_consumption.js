const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting historical consumption data fix...');

  // 1. Get all beneficiaries who have transactions
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { transactions: { some: {} } },
    select: { id: true, name: true }
  });

  console.log(`🔍 Found ${beneficiaries.length} beneficiaries to process.`);

  for (const beneficiary of beneficiaries) {
    // 2. Get all non-cancelled transactions for this beneficiary, ordered by date
    const transactions = await prisma.transaction.findMany({
      where: { beneficiary_id: beneficiary.id, is_cancelled: false },
      orderBy: { created_at: 'asc' }
    });

    if (transactions.length === 0) continue;

    console.log(`📦 Processing ${transactions.length} transactions for: ${beneficiary.name}`);

    // We need to track consumption per service category / wallet
    // Since categories might overlap or be null, we'll group by service_category or type
    const categoryConsumption = new Map();

    for (const tx of transactions) {
      const category = tx.service_category || tx.type;
      const currentConsumed = categoryConsumption.get(category) || 0;
      
      const amountDeducted = Number(tx.ceiling_consumed || tx.actual_company_share || tx.amount || 0);
      const newConsumed = currentConsumed + amountDeducted;

      // Update the transaction with calculated cumulative values
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          consumed_before: currentConsumed,
          consumed_after: newConsumed
        }
      });

      categoryConsumption.set(category, newConsumed);
    }
  }

  console.log('✅ Historical consumption data fixed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
