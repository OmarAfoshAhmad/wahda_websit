const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const txs = await prisma.transaction.findMany({
    where: { idempotency_key: { startsWith: 'import-optics-tx:' } },
    select: { idempotency_key: true, company_id: true, beneficiary_id: true, amount: true }
  });
  console.log(JSON.stringify(txs, null, 2));
}
main().finally(() => prisma.$disconnect());
