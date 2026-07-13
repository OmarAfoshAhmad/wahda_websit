const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestJob = await prisma.restoreJob.findFirst({
    orderBy: { created_at: 'desc' },
  });

  if (!latestJob) {
    console.log("No jobs found");
    return;
  }

  const buffer = Buffer.from(latestJob.encrypted_payload);
  console.log("Buffer length:", buffer.length);
  console.log("First 100 bytes (hex):", buffer.subarray(0, 100).toString('hex'));
  console.log("First 100 bytes (ascii):", buffer.subarray(0, 100).toString('ascii'));
}

main().catch(console.error).finally(() => prisma.$disconnect());
