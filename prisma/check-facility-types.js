const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const facs = await prisma.facility.findMany({ select: { facility_type: true }, distinct: ['facility_type'] });
  console.log(facs);
  await prisma.$disconnect();
}
run();
