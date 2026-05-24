const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash("Aya123", 10);
  await prisma.facility.update({
    where: { username: "aya" },
    data: { password_hash: hash }
  });
  console.log("Password for aya updated to Aya123 successfully");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
