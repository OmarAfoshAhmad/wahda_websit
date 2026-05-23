const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cards = ['ARCAD20250004', 'ARCAD20250047'];
  
  for (const card of cards) {
    console.log(`\n=================== Inspecting Card: ${card} ===================`);
    const ben = await prisma.beneficiary.findFirst({
      where: { card_number: card },
      include: {
        company: true,
        transactions: {
          where: { is_cancelled: false },
          orderBy: { created_at: 'asc' }
        }
      }
    });
    
    if (!ben) {
      console.log(`Beneficiary not found for card: ${card}`);
      continue;
    }
    
    console.log(`Beneficiary ID: ${ben.id}`);
    console.log(`Name: ${ben.name}`);
    console.log(`Card Number: ${ben.card_number}`);
    console.log(`Status: ${ben.status}`);
    console.log(`Company ID: ${ben.company_id}`);
    console.log(`Company Name: ${ben.company?.name}`);
    console.log(`Total Initial Balance: ${ben.total_balance}`);
    console.log(`Remaining Balance: ${ben.remaining_balance}`);
    
    console.log(`\nTransactions count: ${ben.transactions.length}`);
    let sumCompanyShare = 0;
    let sumAmount = 0;
    ben.transactions.forEach((tx, idx) => {
      console.log(`  [Tx ${idx+1}] ID: ${tx.id} | Type: ${tx.type} | Amount: ${tx.amount} | Co Share: ${tx.actual_company_share} | Consumed: ${tx.ceiling_consumed} | Date: ${tx.created_at}`);
      sumCompanyShare += Number(tx.actual_company_share ?? 0);
      sumAmount += Number(tx.amount ?? 0);
    });
    console.log(`Sum of Company Share: ${sumCompanyShare}`);
    console.log(`Sum of Amount: ${sumAmount}`);
    
    // Check WalletConsumption or other tables if they exist
    const consumptions = await prisma.walletConsumption?.findMany({
      where: { beneficiary_id: ben.id }
    });
    if (consumptions) {
      console.log(`\nWalletConsumptions:`);
      consumptions.forEach(c => {
        console.log(`  - Type: ${c.type} | Consumed: ${c.amount_consumed} | Updated At: ${c.updated_at}`);
      });
    }
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
