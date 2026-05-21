const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.facility.findMany({
    select: { id: true, name: true }
  });
  console.log('Facilities:', facilities);
}

main().catch(console.error).finally(() => prisma.$disconnect());
