const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Checking recent Import Jobs ===");
  const jobs = await prisma.importJob.findMany({
    orderBy: { created_at: "desc" },
    take: 10
  });
  
  for (const job of jobs) {
    console.log(`\nJob ID: ${job.id}`);
    console.log(`Created At: ${job.created_at}`);
    console.log(`Status: ${job.status}`);
    console.log(`Total Rows: ${job.total_rows}`);
    console.log(`Processed: ${job.processed_rows}`);
    console.log(`Inserted: ${job.inserted_rows}`);
    console.log(`Duplicate: ${job.duplicate_rows}`);
    console.log(`Failed: ${job.failed_rows}`);
    console.log(`Error Message: ${job.error_message}`);
    if (job.skipped_rows_report) {
      console.log(`Skipped Report:`);
      console.log(JSON.stringify(job.skipped_rows_report, null, 2));
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
