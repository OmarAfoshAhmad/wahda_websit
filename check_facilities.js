const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const allFacilities = await prisma.facility.findMany({
    select: {
      username: true,
      is_employee: true,
      deleted_at: true,
      manager_permissions: true
    }
  });

  console.log("All Facilities Data:");
  console.log(JSON.stringify(allFacilities, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
