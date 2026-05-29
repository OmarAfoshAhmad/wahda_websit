const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const nameQuery = "%عبداللة حسن فرج بن جويرف%";
  const beneficiaries = await prisma.$queryRaw`
    SELECT id, card_number, name, birth_date, deleted_at, status
    FROM "Beneficiary"
    WHERE name ILIKE ${nameQuery}
  `;
  console.log("Matching Beneficiaries:", beneficiaries);
}

main().catch(console.error).finally(() => prisma.$disconnect());
