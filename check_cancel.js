const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const beneficiaryId = 'cmnfndmp90354n210h0mpcm6h';
  const audits = await prisma.auditLog.findMany({
    where: { 
      action: 'CANCEL_TRANSACTION',
      created_at: { gte: new Date('2026-05-16T05:10:00Z') }
    },
    orderBy: { created_at: 'asc' }
  });
  
  // Filter manually
  const relevant = audits.filter(a => JSON.stringify(a.metadata).includes('WAB202504202') || JSON.stringify(a.metadata).includes(beneficiaryId));
  console.dir(relevant, { depth: null });
}

main().finally(() => process.exit(0));
