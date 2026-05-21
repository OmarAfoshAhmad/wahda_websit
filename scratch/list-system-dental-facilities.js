const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const providers = await prisma.healthProvider.findMany({
    orderBy: { name: 'asc' }
  });
  console.log(`System Providers Count: ${providers.length}`);
  providers.forEach(p => {
    console.log(`  - ID: ${p.id} | Name: "${p.name}" | Status: ${p.status}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
