const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  try {
    const results = await prisma.$queryRawUnsafe(`SELECT city, batch_number FROM "CardIssuanceRegistryAll"`);
    const data = {};
    results.forEach(r => {
      const city = r.city;
      const batch = Number(r.batch_number);
      if (!data[city]) data[city] = new Set();
      data[city].add(batch);
    });
    Object.keys(data).sort().forEach(city => {
      const sortedBatches = Array.from(data[city]).sort((a, b) => a - b);
      console.log(`${city}: ${sortedBatches.join(", ")} (Count: ${sortedBatches.length})`);
      const has16 = sortedBatches.includes(16);
      console.log(`Batch 16 in ${city}: ${has16 ? "Yes" : "No"}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
