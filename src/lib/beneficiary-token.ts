import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_TTL_DAYS = 90;

function getSecret(): string {
  const secret = process.env.BENEFICIARY_TOKEN_SECRET;
  if (!secret) throw new Error("BENEFICIARY_TOKEN_SECRET not set");
  return secret;
}

/**
 * Creates a signed token encoding the beneficiary ID with expiration.
 * Format: base64url(id) + "." + base64url(expiryMs) + "." + hmac(id:expiry, secret).slice(0,32)
 */
export function createBeneficiaryToken(beneficiaryId: string): string {
  const expiryMs = Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const idPart = Buffer.from(beneficiaryId).toString("base64url");
  const expiryPart = Buffer.from(String(expiryMs)).toString("base64url");
  const sig = createHmac("sha256", getSecret())
    .update(`${beneficiaryId}:${expiryMs}`)
    .digest("base64url")
    .slice(0, 32);
  return `${idPart}.${expiryPart}.${sig}`;
}

/**
 * Verifies the token and returns the beneficiary ID, or null if invalid/tampered/expired.
 */
export function verifyBeneficiaryToken(token: string): string | null {
  const parts = token.split(".");

  // دعم التوكنات القديمة (بدون انتهاء صلاحية) — جزءين فقط
  if (parts.length === 2) {
    return verifyLegacyToken(parts[0], parts[1]);
  }

  if (parts.length !== 3) return null;

  try {
    const [idPart, expiryPart, receivedSig] = parts;
    const id = Buffer.from(idPart, "base64url").toString("utf8");
    const expiryMs = Number(Buffer.from(expiryPart, "base64url").toString("utf8"));

    if (!Number.isFinite(expiryMs) || Date.now() > expiryMs) return null;

    const expectedSig = createHmac("sha256", getSecret())
      .update(`${id}:${expiryMs}`)
      .digest("base64url")
      .slice(0, 32);
    const a = Buffer.from(receivedSig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return id;
  } catch {
    return null;
  }
}

/**
 * التحقق من التوكنات القديمة بصيغة جزءين — بدون صلاحية.
 * يتطلب ضبط BENEFICIARY_TOKEN_LEGACY_SECRET صراحةً؛
 * لا نستخدم JWT_SECRET هنا لتجنّب مشاركة المفاتيح بين الأنظمة.
 */
function verifyLegacyToken(idPart: string, receivedSig: string): string | null {
  try {
    const legacySecret = process.env.BENEFICIARY_TOKEN_LEGACY_SECRET;
    if (!legacySecret) return null;

    const id = Buffer.from(idPart, "base64url").toString("utf8");
    const expectedSig = createHmac("sha256", legacySecret)
      .update(id)
      .digest("base64url")
      .slice(0, 22);
    const a = Buffer.from(receivedSig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return id;
  } catch {
    return null;
  }
}
