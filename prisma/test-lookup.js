const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Searching InsuranceCompany ===");
  const companies = await prisma.insuranceCompany.findMany({
    where: {
      OR: [
        { name: { contains: "اسمنت", mode: "insensitive" } },
        { name: { contains: "جمارك", mode: "insensitive" } },
        { name: { contains: "الجمارك", mode: "insensitive" } },
        { name: { contains: "الإسمنت", mode: "insensitive" } }
      ]
    }
  });
  console.log(JSON.stringify(companies, null, 2));

  console.log("\n=== Searching Facility ===");
  const facilities = await prisma.facility.findMany({
    where: {
      OR: [
        { name: { contains: "اسمنت", mode: "insensitive" } },
        { name: { contains: "جمارك", mode: "insensitive" } },
        { name: { contains: "الجمارك", mode: "insensitive" } },
        { name: { contains: "الإسمنت", mode: "insensitive" } }
      ]
    }
  });
  console.log(JSON.stringify(facilities, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
