const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const nameQuery = "فجرية";
  const cardQuery = "9998";

  console.log("--- Searching Beneficiaries in System ---");
  const sysRows = await prisma.beneficiary.findMany({
    where: {
      OR: [
        { name: { contains: nameQuery } },
        { card_number: { contains: cardQuery } }
      ]
    }
  });
  console.log(sysRows.map(r => ({
    id: r.id,
    name: r.name,
    card_number: r.card_number,
    birth_date: r.birth_date,
    deleted_at: r.deleted_at
  })));

  console.log("--- Searching Truth Registry ---");
  const truthRows = await prisma.cardIssuanceRegistryAll.findMany({
    where: {
      OR: [
        { beneficiary_name: { contains: nameQuery } },
        { card_number: { contains: cardQuery } }
      ]
    }
  });
  console.log(truthRows.map(r => ({
    id: r.id,
    name: r.beneficiary_name,
    card_number: r.card_number,
    birth_date: r.birth_date
  })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
