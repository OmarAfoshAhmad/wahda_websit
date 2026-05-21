const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.importJob.findMany({
    orderBy: { created_at: 'desc' },
    take: 10
  });
  console.log(`Recent Import Jobs:`);
  jobs.forEach(job => {
    console.log(`ID: ${job.id}`);
    console.log(`Type: ${job.type}`);
    console.log(`Status: ${job.status}`);
    console.log(`Stats: Total=${job.total_rows}, Success=${job.success_rows}, Failed=${job.failed_rows}`);
    console.log(`Error: ${job.error_message}`);
    console.log(`Summary:`, JSON.stringify(job.summary));
    console.log(`-----------------------------------`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
