const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.facility.findMany({
    where: {
      OR: [
        { name: { contains: 'اسنان', mode: 'insensitive' } },
        { name: { contains: 'أسنان', mode: 'insensitive' } },
        { name: { contains: 'سن', mode: 'insensitive' } }
      ]
    },
    select: { id: true, name: true }
  });
  console.log('Dental Facilities in DB:', facilities);
}

main().catch(console.error).finally(() => prisma.$disconnect());
