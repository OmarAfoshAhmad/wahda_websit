const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.findFirst({
    where: { name: { contains: 'جميع' } }
  });
  if (!facility) {
    console.log("Facility not found");
    return;
  }
  console.log("Facility:", facility.name, "ID:", facility.id);
  
  const txs = await prisma.transaction.findMany({
    where: { facility_id: facility.id },
    select: {
      type: true,
      is_cancelled: true,
    }
  });
  console.log("Total txs:", txs.length);
  console.log("Txs breakdown:", txs.reduce((acc, t) => {
    const key = `${t.type} (cancelled: ${t.is_cancelled})`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}));
}

main().catch(console.error).finally(() => prisma.$disconnect());
