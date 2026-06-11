import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const types = await prisma.transaction.findMany({
    select: { type: true, service_category: true },
    distinct: ['type', 'service_category']
  });
  console.log("Distinct types/categories:");
  console.log(types);
}

main().finally(() => prisma.$disconnect());
