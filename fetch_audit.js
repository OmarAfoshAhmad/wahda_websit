import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const log = await prisma.auditLog.findUnique({
    where: { id: 'cmp86j447002mu9d833xmr62a' },
  });
  console.log(JSON.stringify(log, null, 2));
}

main().finally(() => prisma.$disconnect());
