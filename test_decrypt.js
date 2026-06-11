const { PrismaClient } = require('@prisma/client');
const { decryptBackup } = require('./src/lib/backup-crypto');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  const latestJob = await prisma.restoreJob.findFirst({
    orderBy: { created_at: 'desc' },
  });

  if (!latestJob) {
    console.log("No jobs found");
    return;
  }

  console.log("Job ID:", latestJob.id);
  const buffer = Buffer.from(latestJob.encrypted_payload);
  console.log("Buffer length:", buffer.length);
  
  try {
    const res = decryptBackup(buffer);
    console.log("Decrypted successfully. Length:", res.length);
  } catch (e) {
    console.error("Decryption failed:", e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
