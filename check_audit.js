import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const beneficiaryId = 'cmnfndmp90354n210h0mpcm6h';
  
  const audits = await prisma.auditLog.findMany({
    where: { 
      metadata: { path: ['beneficiary_id'], equals: beneficiaryId }
    },
    orderBy: { created_at: 'asc' }
  });
  
  // also check without metadata filtering just in case
  const allAudits = await prisma.auditLog.findMany({
    where: { created_at: { gte: new Date('2026-05-16T04:10:00Z'), lte: new Date('2026-05-16T05:10:00Z') } },
    orderBy: { created_at: 'asc' }
  });
  
  console.log("Audits directly matching:");
  console.dir(audits, { depth: null });
  
  console.log("All audits in time window:");
  const relevantAudits = allAudits.filter(a => JSON.stringify(a.metadata).includes(beneficiaryId) || JSON.stringify(a.metadata).includes('WAB202504202'));
  console.dir(relevantAudits, { depth: null });
}

main().finally(() => prisma.$disconnect());
