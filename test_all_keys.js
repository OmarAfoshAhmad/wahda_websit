const fs = require('fs');
const { createDecipheriv, scryptSync } = require('crypto');
const { gunzipSync } = require('zlib');
const { PrismaClient } = require('@prisma/client');

const envFile = fs.readFileSync('.env', 'utf-8');
const allSecrets = [];
envFile.split('\n').forEach(line => {
  if (line.includes('=')) {
    const [k, v] = line.split('=');
    allSecrets.push(v.trim());
  }
});

const prisma = new PrismaClient();

async function main() {
  const latestJob = await prisma.restoreJob.findFirst({
    orderBy: { created_at: 'desc' },
  });

  const encryptedBuffer = Buffer.from(latestJob.encrypted_payload);

  const SALT_LENGTH = 32;
  const IV_LENGTH = 16;
  const TAG_LENGTH = 16;

  const salt = encryptedBuffer.subarray(0, SALT_LENGTH);
  const iv = encryptedBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  for (const password of allSecrets) {
    try {
      const key = scryptSync(password, salt, 32);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      const decompressed = gunzipSync(compressed);
      console.log("SUCCESS WITH SECRET:", password);
      return;
    } catch (e) {
      // ignore
    }
  }
  
  console.log("FAILED WITH ALL SECRETS IN .ENV");
}

main().catch(console.error).finally(() => prisma.$disconnect());
