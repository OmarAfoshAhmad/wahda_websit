const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const arcadia = await prisma.insuranceCompany.findFirst({ where: { code: 'ARCD' } });
  console.log("Arcadia ID in DB:", arcadia?.id);

  const txs = await prisma.transaction.findMany({
    where: { idempotency_key: { startsWith: 'import-optics-tx:' }, beneficiary: { card_number: { startsWith: 'ARCAD' } } },
    select: { idempotency_key: true, company_id: true }
  });
  console.log("Arcadia Txs in DB:", JSON.stringify(txs, null, 2));
}
main().finally(() => prisma.$disconnect());
