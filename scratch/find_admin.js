const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const admins = await prisma.facility.findMany({
    where: { is_admin: true }
  });
  console.log("Admins:", JSON.stringify(admins, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
