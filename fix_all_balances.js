import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function expectedStatus(currentStatus, expectedRemaining) {
  if (currentStatus === "SUSPENDED") return "SUSPENDED";
  return expectedRemaining <= 0 ? "FINISHED" : "ACTIVE";
}

async function fixBalances() {
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { deleted_at: null }
  });
  
  let fixed = 0;
  for (const ben of beneficiaries) {
    const txns = await prisma.transaction.findMany({
      where: {
        beneficiary_id: ben.id,
        is_cancelled: false,
        type: { notIn: ["CANCELLATION", "DENTAL"] }
      },
      select: { amount: true, actual_company_share: true }
    });
    
    const total = Number(ben.total_balance);
    const ledgerSpent = txns.reduce((sum, t) => sum + Number(t.actual_company_share ?? t.amount ?? 0), 0);
    const computedRemaining = Math.max(0, total - ledgerSpent);
    const shouldStatus = expectedStatus(ben.status, computedRemaining);
    
    if (Number(ben.remaining_balance) !== computedRemaining || ben.status !== shouldStatus) {
      console.log(`Fixing ${ben.card_number} (${ben.name}): stored=${ben.remaining_balance} computed=${computedRemaining}`);
      await prisma.beneficiary.update({
        where: { id: ben.id },
        data: { remaining_balance: computedRemaining, status: shouldStatus }
      });
      fixed++;
    }
  }
  
  console.log(`Fixed ${fixed} corrupted balances.`);
}

fixBalances().finally(() => prisma.$disconnect());
