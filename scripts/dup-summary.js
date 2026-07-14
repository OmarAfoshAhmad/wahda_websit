const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const allImports = await p.transaction.count({ where: { type: 'IMPORT' } });

  const raw = await p.$queryRaw`
    SELECT beneficiary_id, COUNT(*) as cnt, SUM(amount) as total_amount
    FROM "Transaction" 
    WHERE type = 'IMPORT'
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  `;

  const dupCount = raw.length;
  const totalExtraAmount = raw.reduce((s, r) => s + Number(r.total_amount) / 2, 0);

  const dates = await p.$queryRaw`
    SELECT DATE(created_at) as d, COUNT(*) as cnt
    FROM "Transaction"
    WHERE type = 'IMPORT'
    GROUP BY DATE(created_at)
    ORDER BY d
  `;

  console.log('=== ملخص التحليل ===');
  console.log('إجمالي حركات الاستيراد:', allImports);
  console.log('عدد المستفيدين المكررين:', dupCount);
  console.log('المبلغ الزائد المقدر:', totalExtraAmount.toFixed(2));
  console.log('تواريخ الاستيراد:');
  dates.forEach(d => console.log('  ', d.d, '-', Number(d.cnt), 'حركة'));

  const withThree = raw.filter(r => Number(r.cnt) > 2);
  console.log('مستفيدون بأكثر من 2 حركة:', withThree.length);

  const facilities = await p.$queryRaw`
    SELECT t.facility_id, f.name, COUNT(*) as cnt
    FROM "Transaction" t
    JOIN "Facility" f ON t.facility_id = f.id
    WHERE t.type = 'IMPORT'
    GROUP BY t.facility_id, f.name
  `;
  console.log('توزيع المرافق:');
  facilities.forEach(f => console.log('  ', f.name, '-', Number(f.cnt), 'حركة'));

  const finishedCount = await p.beneficiary.count({
    where: {
      id: { in: raw.map(r => r.beneficiary_id) },
      status: 'FINISHED'
    }
  });
  console.log('مستفيدون بحالة FINISHED بسبب التكرار:', finishedCount);

  await p.$disconnect();
})();
