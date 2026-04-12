const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const txs = await p.transaction.findMany({
    where: { 
      beneficiary: { card_number: 'WAB2025000747' },
      type: 'IMPORT'
    },
    select: { id: true, amount: true, created_at: true, facility_id: true },
    orderBy: { created_at: 'asc' }
  });
  console.log('WAB2025000747 IMPORT txs:', JSON.stringify(txs, null, 2));
  
  const audits = await p.auditLog.findMany({
    where: { action: 'IMPORT_TRANSACTIONS' },
    select: { id: true, created_at: true, user: true, facility_id: true },
    orderBy: { created_at: 'asc' }
  });
  console.log('Import audit logs:', audits.length);
  audits.forEach(a => console.log('  ', a.created_at.toISOString(), a.user, a.facility_id));
  
  await p.$disconnect();
})();
