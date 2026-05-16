import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const beneficiaryId = 'cmnfndmp90354n210h0mpcm6h';
  const beneficiary = await prisma.beneficiary.findUnique({
    where: { id: beneficiaryId },
  });
  
  const txns = await prisma.transaction.findMany({
    where: { 
      beneficiary_id: beneficiaryId,
      is_cancelled: false,
      type: { notIn: ["CANCELLATION", "DENTAL"] }
    },
    select: { amount: true, actual_company_share: true, actual_patient_share: true }
  });
  
  const total = Number(beneficiary.total_balance);
  const ledgerSpent = txns.reduce((sum, t) => sum + Number(t.actual_company_share ?? t.amount ?? 0), 0);
  const computedRemaining = Math.max(0, total - ledgerSpent);
  
  console.log("Total Balance:", total);
  console.log("Ledger Spent:", ledgerSpent);
  console.log("Computed Remaining:", computedRemaining);
  console.log("Stored Remaining:", Number(beneficiary.remaining_balance));
  console.log("Txns:", JSON.stringify(txns, null, 2));
}

main().finally(() => prisma.$disconnect());
