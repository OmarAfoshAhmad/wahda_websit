const fs = require('fs');

// Load env
const envFile = fs.readFileSync('.env', 'utf-8');
envFile.split('\n').forEach(line => {
  if (line.includes('=')) {
    const [k, v] = line.split('=');
    process.env[k.trim()] = v.trim();
  }
});

const { encryptBackup, decryptBackup } = require('./src/lib/backup-crypto');

try {
  const buf = encryptBackup('hello world');
  console.log('Encrypted length:', buf.length);
  const dec = decryptBackup(buf);
  console.log('Decrypted:', dec);
} catch (e) {
  console.error("Error:", e.message);
}
