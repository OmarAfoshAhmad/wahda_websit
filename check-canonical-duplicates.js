const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Copy canonicalizeCardNumber logic
function normalizeCardNumber(value) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function canonicalizeCardNumber(value) {
  const c = normalizeCardNumber(value);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;
  const normalizedDigits = m[1].replace(/^0+/, "") || "0";
  const suffix = m[2] ?? "";
  return `WAB2025${normalizedDigits}${suffix}`;
}

async function main() {
  const bens = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      company_id: 'cmp7ha2km0000u9v8jse4ib5x'
    },
    select: {
      id: true,
      name: true,
      card_number: true,
      created_at: true,
    }
  });

  const canonicalGroups = {};
  for (const b of bens) {
    const canonical = canonicalizeCardNumber(b.card_number);
    if (!canonicalGroups[canonical]) {
      canonicalGroups[canonical] = [];
    }
    canonicalGroups[canonical].push(b);
  }

  let totalDuplicateGroups = 0;
  let totalDuplicateBensCount = 0;
  const sampleGroups = [];

  for (const [canonical, group] of Object.entries(canonicalGroups)) {
    if (group.length > 1) {
      totalDuplicateGroups++;
      totalDuplicateBensCount += group.length;
      sampleGroups.push({ canonical, group });
    }
  }

  console.log('Total unique canonical card numbers:', Object.keys(canonicalGroups).length);
  console.log('Total duplicate canonical groups:', totalDuplicateGroups);
  console.log('Total beneficiaries in duplicate groups:', totalDuplicateBensCount);
  
  if (sampleGroups.length > 0) {
    console.log('Sample duplicate groups (first 5):');
    for (const sg of sampleGroups.slice(0, 5)) {
      console.log(`Canonical Card: ${sg.canonical}`);
      for (const b of sg.group) {
        console.log(`  - ID: ${b.id}, Card: ${b.card_number}, Name: ${b.name}, Created: ${b.created_at.toISOString()}`);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
