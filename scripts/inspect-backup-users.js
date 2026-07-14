const fs = require('fs');
const path = require('path');
const { createDecipheriv, scryptSync } = require('crypto');
const { gunzipSync } = require('zlib');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function deriveKey(password, salt) {
  return scryptSync(password, salt, KEY_LENGTH);
}

function decryptBackup(buffer) {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('BACKUP_ENCRYPTION_KEY is not set');
  }

  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return gunzipSync(compressed).toString('utf8');
}

function main() {
  const fileArg = process.argv[2];
  const targetUsername = process.argv[3] || 'wbrph';
  if (!fileArg) {
    throw new Error('Usage: node scripts/inspect-backup-users.js <backup-file> [username]');
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  const buffer = fs.readFileSync(filePath);
  const json = decryptBackup(buffer);
  const backup = JSON.parse(json);
  const users = Array.isArray(backup?.data?.users) ? backup.data.users : [];
  const target = users.find((u) => u.username === targetUsername) || null;

  const rows = users.filter((u) => !u.deleted_at && u.must_change_password === true);
  const byHash = new Map();
  for (const row of rows) {
    const key = row.password_hash || '__NULL__';
    const list = byHash.get(key) || [];
    list.push(row.username);
    byHash.set(key, list);
  }

  const groups = [...byHash.entries()]
    .map(([hash, usernames]) => ({ hash, count: usernames.length, usernames }))
    .sort((a, b) => b.count - a.count);

  console.log(JSON.stringify({
    file: filePath,
    exported_at: backup.exported_at,
    created_by: backup.created_by,
    includes_sensitive: backup.includes_sensitive,
    users_count: users.length,
    active_must_change_password_count: rows.length,
    distinct_hashes_for_active_must_change: groups.length,
    top_groups: groups.slice(0, 10).map((g) => ({ count: g.count, hash: g.hash, usernames: g.usernames.slice(0, 20) })),
    targetUser: target,
  }, null, 2));
}

main();
