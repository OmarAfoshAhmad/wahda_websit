const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const count = await prisma.transaction.count({
    where: { consumed_after: { not: null } }
  });
  console.log(`📊 Number of transactions with consumed_after: ${count}`);
  
  const sample = await prisma.transaction.findFirst({
    where: { consumed_after: { not: null } },
    select: { id: true, consumed_after: true }
  });
  console.log('🧪 Sample data:', sample);
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
