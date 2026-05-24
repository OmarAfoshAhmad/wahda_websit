const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  const comps = await prisma.insuranceCompany.findMany({
    where: {
      OR: [
        { name: { contains: "جوليانة" } },
        { name: { contains: "Alia" } },
        { name: { contains: "العالية" } },
        { code: { contains: "JUL" } }
      ]
    }
  });
  console.log(comps);
}
main().finally(() => prisma.$disconnect());
