const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const job = await prisma.importJob.findUnique({
    where: { id: 'cmqy9ocu70000u9scaokxz1i3' },
    select: { payload: true }
  });

  const payload = Array.isArray(job.payload) ? job.payload : [];
  console.log('Total rows in payload:', payload.length);
  
  const digitCounts = {};
  const sampleCards = [];

  for (const row of payload) {
    if (row.card_number) {
      const card = String(row.card_number).trim().toUpperCase();
      const m = card.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
      if (m) {
        const digits = m[1];
        const len = digits.length;
        digitCounts[len] = (digitCounts[len] || 0) + 1;
        if (sampleCards.length < 15) {
          sampleCards.push({ original: card, digits, len });
        }
      }
    }
  }

  console.log('Distribution of length of digits after WAB2025:', digitCounts);
  console.log('Sample card numbers from Excel payload:', sampleCards);
}

main().catch(console.error).finally(() => prisma.$disconnect());
