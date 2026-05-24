const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.facility.findMany({
    where: {
      name: { contains: "اية" }
    }
  });
  console.log("Found facilities:", JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
