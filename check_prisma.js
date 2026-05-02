const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  console.log("Prisma keys:", Object.keys(prisma).filter(k => !k.startsWith("_")));
  const model = prisma.cardIssuanceRegistry;
  if (!model) {
      console.log("cardIssuanceRegistry is undefined");
      return;
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
