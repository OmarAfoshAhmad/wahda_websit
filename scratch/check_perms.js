const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const managers = await prisma.facility.findMany({
      where: { 
        OR: [
          { is_manager: true },
          { is_employee: true }
        ]
      },
      take: 10
    });
    
    console.log("Managers/Employees found:", managers.length);
    managers.forEach(m => {
      console.log(`- ${m.name} (${m.username}): is_manager=${m.is_manager}, is_employee=${m.is_employee}`);
      console.log(`  Permissions: ${JSON.stringify(m.manager_permissions)}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
