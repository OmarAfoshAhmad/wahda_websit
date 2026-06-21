import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.beneficiary.count({ where: { company_id: null, card_number: { startsWith: 'WAB' } }});
  console.log('Null company WAB count:', count);
}

main().finally(() => prisma.$disconnect());
