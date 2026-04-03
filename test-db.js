const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.importJob.findMany({
    orderBy: { created_at: 'desc' },
    take: 3
  });
  let output = "";
  for (const job of jobs) {
    output += `Status: ${job.status}\n`;
    output += `Total: ${job.total_rows}\n`;
    output += `Processed: ${job.processed_rows}\n`;
    output += `Inserted: ${job.inserted_rows}\n`;
    output += `Duplicate: ${job.duplicate_rows}\n`;
    output += `Failed: ${job.failed_rows}\n`;
    output += `Metadata (first 500 chars): ${JSON.stringify(job.skipped_rows_report).substring(0, 500)}\n\n`;
  }
  fs.writeFileSync('c:\\Users\\Omar\\waad_temp_website\\db-output.txt', output);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
