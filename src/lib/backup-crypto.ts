/**
 * تشفير وفك تشفير النسخ الاحتياطية باستخدام AES-256-GCM
 * مع ضغط gzip
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { gzipSync, gunzipSync } from "zlib";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

function getEncryptionPassword(): string {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be set — لا تستخدم JWT_SECRET للنسخ الاحتياطية");
  }
  return secret;
}

/**
 * يشفّر البيانات (JSON string) → Buffer مشفّر ومضغوط
 * الشكل: [salt(32)] [iv(16)] [authTag(16)] [encryptedData(...)]
 */
export function encryptBackup(jsonData: string): Buffer {
  const password = getEncryptionPassword();
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);

  // ضغط أولاً ثم تشفير
  const compressed = gzipSync(Buffer.from(jsonData, "utf-8"));

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // salt + iv + authTag + encrypted
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * يفك تشفير Buffer → JSON string
 */
export function decryptBackup(encryptedBuffer: Buffer): string {
  const password = getEncryptionPassword();

  if (encryptedBuffer.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("ملف النسخة الاحتياطية تالف أو غير صالح");
  }

  const salt = encryptedBuffer.subarray(0, SALT_LENGTH);
  const iv = encryptedBuffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = encryptedBuffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  // فك الضغط
  const decompressed = gunzipSync(compressed);
  return decompressed.toString("utf-8");
}
