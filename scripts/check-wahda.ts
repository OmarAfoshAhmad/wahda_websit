import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const wahdaCompanies = await prisma.insuranceCompany.findMany({
    where: { 
      OR: [
        { name: { contains: "الوحدة" } },
        { name: { contains: "Wahda" } }
      ]
    },
    include: {
      _count: {
        select: { beneficiaries: true }
      }
    }
  });

  console.log("Wahda companies found:");
  wahdaCompanies.forEach(c => {
    console.log(`- ID: ${c.id}`);
    console.log(`  Name: ${c.name}`);
    console.log(`  Active: ${c.is_active}`);
    console.log(`  Deleted At: ${c.deleted_at}`);
    console.log(`  Beneficiaries Count: ${c._count.beneficiaries}`);
    console.log("-------------------");
  });
}

main().finally(() => prisma.$disconnect());
