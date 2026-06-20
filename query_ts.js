const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const arcadCompany = await prisma.insuranceCompany.findFirst({
    where: { code: 'ARCAD' }
  });
  
  if (!arcadCompany) return;

  const txs = await prisma.transaction.findMany({
    where: {
      company_id: arcadCompany.id,
      type: 'OPTICS'
    },
    select: {
      id: true,
      calc_metadata: true,
      idempotency_key: true
    }
  });
  console.log(txs.map(t => ({ id: t.id, ts: t.calc_metadata?.timestamp, key: t.idempotency_key })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
