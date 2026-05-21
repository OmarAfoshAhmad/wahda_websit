const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.facility.findMany({
    orderBy: { name: 'asc' }
  });
  console.log(`System Facilities Count: ${facilities.length}`);
  facilities.forEach(f => {
    console.log(`  - ID: ${f.id} | Name: "${f.name}" | Username: "${f.username}" | is_admin: ${f.is_admin} | is_employee: ${f.is_employee}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
