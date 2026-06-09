const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ayada = await prisma.beneficiary.findFirst({
    where: { name: { contains: 'عيادة رحيل' } }
  });
  if (ayada) {
    console.log("Found Ayada:", ayada.card_number);
    const updated = await prisma.beneficiary.update({
      where: { id: ayada.id },
      data: { card_number: 'WAB2025001400' } // Adding padding
    });
    console.log("Updated Ayada to:", updated.card_number);
  } else {
    console.log("Ayada not found in main DB");
  }
}

main().finally(() => prisma.$disconnect());
