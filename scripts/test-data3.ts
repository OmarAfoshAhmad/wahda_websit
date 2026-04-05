import { PrismaClient } from '@prisma/client';
import { buildDuplicateGroups } from '../src/lib/duplicate-groups';
const p = new PrismaClient();
p.beneficiary.findMany({ 
  where: { 
    card_number: { in: ['WAB2025003583W1', 'WAB20253583W1', 'WAB2025003740', 'WAB20253740'] } 
  } 
})
.then(rows => {
  const { zeroVariantGroups, sameNameGroups } = buildDuplicateGroups(rows as any);
  console.log("Zero Variants:");
  console.log(JSON.stringify(zeroVariantGroups.map(g => ({c: g.canonical, cards: g.members.map(m=>m.card_number)})), null, 2));
  console.log("\nSame Name Groups:");
  console.log(JSON.stringify(sameNameGroups.map(g => ({n: g.nameKey, cards: g.members.map(m=>m.card_number)})), null, 2));
})
.finally(()=> p.$disconnect());