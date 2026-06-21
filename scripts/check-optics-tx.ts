import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const beneficiary = await prisma.beneficiary.findFirst({
    where: { card_number: "WAAD20250001" },
    include: {
      transactions: true
    }
  });

  console.log("Beneficiary:", beneficiary?.name);
  if (beneficiary) {
    beneficiary.transactions.forEach(t => {
      console.log(`Tx ${t.id}: amount=${t.amount}, actual_company_share=${t.actual_company_share}, ceiling_consumed=${t.ceiling_consumed}, type=${t.type}, service_category=${t.service_category}`);
    });
  }
}

main().finally(() => prisma.$disconnect());
