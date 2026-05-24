const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const bcrypt = require("bcryptjs");

async function main() {
  const hash = await bcrypt.hash("aya123", 10);
  await prisma.facility.update({
    where: { username: "aya" },
    data: { password_hash: hash }
  });
  console.log("Aya's password updated to: aya123");
}

main().catch(console.error).finally(() => prisma.$disconnect());
