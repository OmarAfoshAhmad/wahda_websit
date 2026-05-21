const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.facility.findMany({
    where: { is_admin: true },
    select: { username: true, name: true }
  });
  console.log('Admin facilities:', facilities);
}

main().catch(console.error).finally(() => prisma.$disconnect());
