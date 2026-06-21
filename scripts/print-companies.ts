import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const c = await prisma.insuranceCompany.findMany({ select: { id: true, name: true, code: true, card_pattern: true } });
  console.table(c);
}
main().finally(() => prisma.$disconnect());
