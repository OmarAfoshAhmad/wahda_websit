import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const beneficiaryId = 'cmnfndmp90354n210h0mpcm6h';
  const beneficiary = await prisma.beneficiary.findUnique({
    where: { id: beneficiaryId },
  });
  
  const txns = await prisma.transaction.findMany({
    where: { beneficiary_id: beneficiaryId },
    orderBy: { created_at: 'asc' }
  });
  
  console.log("Beneficiary:", JSON.stringify(beneficiary, null, 2));
  console.log("Transactions:", JSON.stringify(txns, null, 2));
}

main().finally(() => prisma.$disconnect());
