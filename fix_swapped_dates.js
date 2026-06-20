const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  
  // Find all future transactions
  const txs = await prisma.transaction.findMany({
    where: {
      created_at: { gt: now }
    },
    select: { id: true, created_at: true }
  });

  console.log(`Found ${txs.length} future transactions to fix.`);

  let fixedCount = 0;

  for (const tx of txs) {
    // tx.created_at is in UTC.
    // In Tripoli time (+02:00), e.g., 2026-10-04T22:00:00Z is 2026-10-05 00:00:00.
    // Let's get the Tripoli date.
    const tripoliDate = new Date(tx.created_at.getTime() + 2 * 60 * 60 * 1000);
    
    const year = tripoliDate.getUTCFullYear();
    const month = tripoliDate.getUTCMonth() + 1; // 1-12
    const day = tripoliDate.getUTCDate();
    
    // If we swap month and day, is it valid?
    // We only swap if month > day (e.g. October 5th -> May 10th) OR if it's just a known bug.
    // Actually, any future date must be a bug.
    // If the date is in the future, it was definitely swapped by the MM/DD/YYYY bug.
    if (day <= 12) {
      // Swap month and day
      // New Tripoli date:
      // Year is same. Month becomes `day`, Day becomes `month`.
      const newMonth = day;
      const newDay = month;
      
      // Construct new UTC date for midnight Tripoli time
      // YYYY-MM-DD T00:00:00+02:00
      const newDateStr = `${year}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}T00:00:00+02:00`;
      const newDate = new Date(newDateStr);
      
      if (newDate <= now) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { created_at: newDate }
        });
        fixedCount++;
        console.log(`Fixed tx ${tx.id}: ${tx.created_at.toISOString()} -> ${newDate.toISOString()}`);
      } else {
        console.log(`Skipped tx ${tx.id} because swapped date ${newDate.toISOString()} is still in the future!`);
      }
    } else {
      console.log(`Cannot safely swap tx ${tx.id}: day is ${day} (> 12)`);
    }
  }

  console.log(`Successfully fixed ${fixedCount} transactions.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
