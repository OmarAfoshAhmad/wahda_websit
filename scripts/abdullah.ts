import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.beneficiary.findMany({ 
  where: { name: 'عبدالله علي محمد الزوي' } 
})
.then(r => console.log(r))
.finally(()=> p.$disconnect());