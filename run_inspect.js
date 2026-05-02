const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  try {
    const models = ['cardIssuanceRegistry', 'cardIssuanceRegistryAll'];
    for (const m of models) {
      if (!prisma[m]) continue;
      console.log('\n--- ' + m + ' ---');
      const stats = await prisma[m].groupBy({ by: ['city', 'batch_number'], _count: { _all: true } });
      const byCity = stats.reduce((acc, curr) => { 
        (acc[curr.city] = acc[curr.city] || []).push(curr); 
        return acc; 
      }, {});
      Object.keys(byCity).forEach(city => {
        const sorted = byCity[city].sort((a, b) => b._count._all - a._count._all);
        console.log('City: ' + city);
        const targets = sorted.filter(i => ['13', '14', '16'].includes(i.batch_number));
        targets.forEach(t => console.log('  Batch ' + t.batch_number + ': ' + t._count._all));
        // Show up to 20 batches
        console.log('  Batches Found: ' + sorted.map(i => i.batch_number + '(' + i._count._all + ')').join(', '));
      });
    }
  } catch (err) {
    console.log('Execution Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
