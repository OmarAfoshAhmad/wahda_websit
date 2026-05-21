const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.importJob.findMany({
    orderBy: { created_at: 'desc' },
    take: 30
  });
  
  // Find job where payload contains WAAD20250001
  const waadJob = jobs.find(job => {
    if (!job.payload || !Array.isArray(job.payload)) return false;
    return job.payload.some(row => row && (row.card_number === 'WAAD20250001' || (row['رقم البطاقة'] === 'WAAD20250001')));
  });
  
  if (!waadJob) {
    console.log(`No Waad job found in the last 30 jobs.`);
    return;
  }
  
  console.log(`Found Waad Job:`);
  console.log(`Job ID: ${waadJob.id}`);
  console.log(`Status: ${waadJob.status}`);
  console.log(`Total: ${waadJob.total_rows}`);
  console.log(`Processed: ${waadJob.processed_rows}`);
  console.log(`Inserted: ${waadJob.inserted_rows}`);
  console.log(`Duplicate: ${waadJob.duplicate_rows}`);
  console.log(`Failed: ${waadJob.failed_rows}`);
  
  if (waadJob.skipped_rows_report) {
    console.log(`Skipped Rows Report (Count: ${Array.isArray(waadJob.skipped_rows_report) ? waadJob.skipped_rows_report.length : 'N/A'}):`);
    console.log(JSON.stringify(waadJob.skipped_rows_report, null, 2));
  } else {
    console.log(`No skipped rows report.`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
