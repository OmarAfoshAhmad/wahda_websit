const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const f = await prisma.facility.findUnique({
    where: { id: "cmn78k17t003gnz1nguqwjd8n" }
  });
  console.log("=== Facility cmn78k17t003gnz1nguqwjd8n ===");
  console.log(JSON.stringify(f, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
