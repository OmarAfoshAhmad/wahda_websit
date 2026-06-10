import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const all = await prisma.insuranceCompany.findMany({
    select: { id: true, name: true, is_active: true }
  });
  console.log("All companies in DB:");
  all.forEach(c => console.log(`- [${c.id}] ${c.name} (Active: ${c.is_active})`));
}

main().finally(() => prisma.$disconnect());
