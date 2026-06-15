const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const policies = await prisma.servicePolicy.findMany({
    include: { service_type: true, company: true }
  });
  const arcd = policies.filter(p => p.company && p.company.code === 'ARCD');
  console.log(JSON.stringify(arcd, null, 2));
}
main().finally(() => prisma.$disconnect());
