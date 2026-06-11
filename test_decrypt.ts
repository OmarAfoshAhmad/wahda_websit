const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestJob = await prisma.restoreJob.findFirst({
    orderBy: { created_at: 'desc' },
  });

  const buffer = Buffer.from(latestJob.encrypted_payload);
  console.log("Hex start:", buffer.subarray(0, 32).toString('hex'));
  console.log("String start:", buffer.subarray(0, 32).toString('utf-8'));
}

main().catch(console.error).finally(() => prisma.$disconnect());
