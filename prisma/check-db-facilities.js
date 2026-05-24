const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.facility.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true, username: true }
  });
  console.log("=== Active Facilities in DB ===");
  console.log(JSON.stringify(facilities, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
