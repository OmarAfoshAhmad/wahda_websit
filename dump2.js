const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const beneficiaryId = 'cmnfndmp90354n210h0mpcm6h';
  
  const txns = await prisma.transaction.findMany({
    where: { beneficiary_id: beneficiaryId },
    orderBy: { created_at: 'asc' }
  });
  
  for (const t of txns) {
    console.log(`[${t.created_at.toISOString()}] ${t.id} | ${t.type} | Amount: ${t.amount} | CoShare: ${t.actual_company_share} | Cancelled: ${t.is_cancelled}`);
  }
}

main().finally(() => process.exit(0));
