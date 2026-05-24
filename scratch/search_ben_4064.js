const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const nameToSearch = "فتحي صالح محمد العشيبي";
  
  console.log("=== Searching Beneficiary ===");
  const bens = await prisma.beneficiary.findMany({
    where: {
      OR: [
        { name: { contains: "فتحي صالح" } },
        { card_number: { contains: "4064" } },
        { card_number: { contains: "34064" } }
      ]
    },
    include: {
      company: true
    }
  });

  bens.forEach(b => {
    console.log(`Beneficiary: ID=${b.id}, Name=${b.name}, Card=${b.card_number}, Company=${b.company ? b.company.name : "None"}, CompanyCode=${b.company ? b.company.code : "None"}`);
  });

  console.log("=== Searching CardNumberingArchive ===");
  const archive = await prisma.cardNumberingArchive.findMany({
    where: {
      OR: [
        { name: { contains: "فتحي صالح" } },
        { card_number: { contains: "4064" } },
        { card_number: { contains: "34064" } }
      ]
    }
  });

  archive.forEach(a => {
    console.log(`Archive: ID=${a.id}, Name=${a.name}, Card=${a.card_number}, EmpNum=${a.employee_number}, Status=${a.status}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
