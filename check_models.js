const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const models = Object.keys(prisma).filter(k => !k.startsWith("_") && !k.startsWith("$"));
  console.log("Available models:", models);
}
main().catch(console.error).finally(() => prisma.$disconnect());
