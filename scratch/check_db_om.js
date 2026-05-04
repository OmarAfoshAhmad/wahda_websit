const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.findFirst({
    where: { username: 'om' }
  });
  console.log('Facility found:', JSON.stringify(facility, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
