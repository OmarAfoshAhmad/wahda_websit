import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.beneficiary.findMany({ 
  where: { 
    card_number: { in: ['WAB2025003583W1', 'WAB20253583W1', 'WAB2025003740', 'WAB20253740'] } 
  } 
})
.then(r => console.log(r))
.finally(()=> p.$disconnect());