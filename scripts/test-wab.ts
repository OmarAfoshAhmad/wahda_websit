import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.insuranceCompany.findMany({ where: { code: "WAB" }});
  console.log("Companies:", companies);

  const bens = await prisma.beneficiary.findMany({ where: { card_number: "WAB2025009846" }});
  console.log("Beneficiaries:", bens);
}

main().finally(() => prisma.$disconnect());
