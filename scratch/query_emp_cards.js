const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function queryEmp() {
  const empNum = "104650";
  console.log(`=== Querying database for employee ${empNum} ===`);
  
  // 1. In Beneficiary table
  const systemBens = await prisma.beneficiary.findMany({
    where: {
      OR: [
        { card_number: { contains: empNum } },
        { name: { contains: "محمد بوبكر" } }
      ]
    }
  });
  console.log("System Beneficiaries count:", systemBens.length);
  systemBens.forEach(b => {
    console.log(`- Card: ${b.card_number}, Name: ${b.name}, Deleted: ${b.deleted_at}`);
  });

  // 2. In CardNumberingArchive table
  const archiveItems = await prisma.cardNumberingArchive.findMany({
    where: {
      employee_number: empNum
    }
  });
  console.log("\nArchive Items count:", archiveItems.length);
  archiveItems.forEach(a => {
    console.log(`- Card: ${a.card_number}, Name: ${a.name}, Status: ${a.status}`);
  });
}

queryEmp()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
