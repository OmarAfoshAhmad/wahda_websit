const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const admins = await prisma.facility.findMany({
    where: { is_admin: true }
  });
  console.log("=== Active Admins ===");
  console.log(JSON.stringify(admins.map(a => ({ id: a.id, name: a.name, username: a.username, is_admin: a.is_admin })), null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
