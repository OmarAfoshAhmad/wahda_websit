const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.importJob.findMany({
    where: {
      status: { not: "COMPLETED" }
    },
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      status: true,
      total_rows: true,
      processed_rows: true,
      inserted_rows: true,
      duplicate_rows: true,
      failed_rows: true,
      error_message: true,
      created_at: true,
      options: true
    }
  });
  console.log("=== Non-Completed Import Jobs ===");
  console.log(JSON.stringify(jobs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
