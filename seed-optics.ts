import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const opticsType = await prisma.serviceType.upsert({
    where: { code: 'OPTICS' },
    update: { name: 'البصريات' },
    create: { code: 'OPTICS', name: 'البصريات' },
  });
  console.log('Optics Type:', opticsType);
}

main().catch(console.error).finally(() => prisma.$disconnect());
