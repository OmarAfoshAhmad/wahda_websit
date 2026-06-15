const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const comp = await prisma.insuranceCompany.findFirst({
    where: { code: 'JMR' },
    include: { service_policies: { include: { service_type: true } } }
  });
  console.log(JSON.stringify(comp.service_policies, null, 2));
}
main().finally(() => prisma.$disconnect());
