const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const c1 = await prisma.beneficiary.count({
    where: { deleted_at: null, company_id: 'cmp7ha2km0000u9v8jse4ib5x' }
  });
  const c2 = await prisma.beneficiary.count({
    where: { deleted_at: null, company_id: null }
  });
  const c3 = await prisma.beneficiary.count({
    where: { deleted_at: null, OR: [{ company_id: 'cmp7ha2km0000u9v8jse4ib5x' }, { company_id: null }] }
  });

  console.log('Non-deleted with Wahda Bank company_id:', c1);
  console.log('Non-deleted with null company_id:', c2);
  console.log('Non-deleted with Wahda Bank OR null:', c3);
}

main().catch(console.error).finally(() => prisma.$disconnect());
