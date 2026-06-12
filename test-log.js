const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const log = await prisma.auditLog.findUnique({
    where: { id: 'cmqalgg2b0053rk0mculm5k9m' }
  });
  console.log("Log exists:", !!log);
  if (log) {
    console.log(JSON.stringify(log.metadata, null, 2));
  } else {
    // If exact ID not found, maybe typo. Let's find the most recent DEDUCT_BALANCE_ERROR
    const recent = await prisma.auditLog.findMany({
      where: { action: 'DEDUCT_BALANCE_ERROR' },
      orderBy: { created_at: 'desc' },
      take: 1
    });
    console.log("Most recent error:");
    console.log(JSON.stringify(recent[0], null, 2));
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
