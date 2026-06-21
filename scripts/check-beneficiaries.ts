import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const cards = [
    'WAB202509870',
    'WAB2025009382',
    'WAB2025004593',
    'WAB2025002772',
    'WAB2025105968',
    'WAB2025104638'
  ];
  const b = await prisma.beneficiary.findMany({ 
    where: { card_number: { in: cards } },
    select: { id: true, name: true, card_number: true, company_id: true }
  });
  console.table(b);

  const missing = cards.filter(c => !b.find(x => x.card_number === c));
  console.log("Missing from DB entirely:", missing);

  const c = await prisma.insuranceCompany.findFirst({ where: { code: 'WAB' }});
  console.log("Wahda company id:", c?.id);
}
main().finally(() => prisma.$disconnect());
