const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.findFirst({
    where: {
      username: { equals: "aya", mode: "insensitive" }
    }
  });

  console.log("=== Facility aya ===");
  console.log(JSON.stringify(facility, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
