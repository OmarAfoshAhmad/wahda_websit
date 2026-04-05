import { PrismaClient } from '@prisma/client';
import { canonicalizeCardNumber } from '../src/lib/normalize';
const p = new PrismaClient();
p.beneficiary.findMany({ 
  where: { 
    card_number: { in: ['WAB2025003583W1', 'WAB20253583W1'] } 
  } 
})
.then(r => {
  const name1 = r[0].name;
  const name2 = r[1].name;
  console.log(`Name 1: "${name1}" (length: ${name1.length})`);
  console.log(`Name 2: "${name2}" (length: ${name2.length})`);
  for(let i=0; i<name1.length; i++) {
    console.log(`Char ${i}: ${name1.charCodeAt(i)} vs ${name2.charCodeAt(i)}`);
  }
  
  const c1 = r[0].card_number;
  const c2 = r[1].card_number;
  console.log("Cards:", c1, c2);
  console.log("Canonical 1:", canonicalizeCardNumber(c1));
  console.log("Canonical 2:", canonicalizeCardNumber(c2));
})
.finally(()=> p.$disconnect());