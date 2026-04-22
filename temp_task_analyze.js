const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const deductCount = await prisma.auditLog.count({
    where: {
      action: 'DEDUCT_BALANCE',
      created_at: { gte: last24h }
    }
  });

  const deductErrorCount = await prisma.auditLog.count({
    where: {
      action: 'DEDUCT_BALANCE_ERROR',
      created_at: { gte: last24h }
    }
  });

  const cashClaimCount = await prisma.auditLog.count({
    where: {
      action: 'CASH_CLAIM',
      created_at: { gte: last24h }
    }
  });

  const transactionCount = await prisma.transaction.count({
    where: {
      type: { in: ['MEDICINE', 'SUPPLIES'] },
      created_at: { gte: last24h },
      is_cancelled: false
    }
  });

  const latestDeductLogs = await prisma.auditLog.findMany({
    where: { action: 'DEDUCT_BALANCE' },
    orderBy: { created_at: 'desc' },
    take: 5
  });

  console.log('--- Statistics (Last 24h) ---');
  console.log('DEDUCT_BALANCE count:', deductCount);
  console.log('DEDUCT_BALANCE_ERROR count:', deductErrorCount);
  console.log('CASH_CLAIM count:', cashClaimCount);
  console.log('MEDICINE/SUPPLIES Transactions count:', transactionCount);

  console.log('\n--- Latest 5 DEDUCT_BALANCE Logs ---');
  latestDeductLogs.forEach(log => {
    const meta = log.metadata || {};
    console.log(`Time: ${log.created_at.toISOString()}`);
    console.log(`Beneficiary: ${meta.beneficiary_name || 'N/A'}`);
    console.log(`Facility: ${meta.facility_name || 'N/A'}`);
    console.log('---');
  });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
