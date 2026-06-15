const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const txs = await prisma.transaction.findMany({
    where: { beneficiary: { card_number: { contains: 'JMR2002525516S2' } } },
    select: {
      amount: true,
      original_company_share: true,
      ceiling_consumed: true,
      calc_metadata: true,
      created_at: true,
      beneficiary: { select: { name: true, card_number: true } }
    }
  });
  console.log(JSON.stringify(txs, null, 2));
}
main().finally(() => prisma.$disconnect());
