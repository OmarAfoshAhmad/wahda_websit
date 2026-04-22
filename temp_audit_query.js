const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const errorLogs = await prisma.auditLog.findMany({
      where: { action: 'DEDUCT_BALANCE_ERROR' },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    console.log('--- Latest 20 DEDUCT_BALANCE_ERROR Logs ---');
    errorLogs.forEach(log => {
      const meta = log.metadata || {};
      console.log(`[${log.createdAt.toISOString()}] User: ${log.userId || 'N/A'} | Error: ${meta.error} | Reason: ${meta.reason} | Card: ${meta.card_number} | Facility: ${meta.facility_name} | Audit ID: ${meta.audit_error_id || 'N/A'}`);
    });

    const successLogs = await prisma.auditLog.findMany({
      where: { action: 'DEDUCT_BALANCE' },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    console.log('\n--- Latest 10 DEDUCT_BALANCE Logs ---');
    successLogs.forEach(log => {
      console.log(`[${log.createdAt.toISOString()}] User: ${log.userId || 'N/A'}`);
    });
  } catch (err) {
    console.error('Error executing query:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
