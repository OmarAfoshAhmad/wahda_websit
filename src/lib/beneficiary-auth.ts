import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "ben_session";
const EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 أيام

let _warnedMissingBenKey = false;
function getKey() {
  const secret = process.env.BENEFICIARY_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) throw new Error("BENEFICIARY_JWT_SECRET or JWT_SECRET not set");
  if (!process.env.BENEFICIARY_JWT_SECRET && !_warnedMissingBenKey) {
    _warnedMissingBenKey = true;
    console.warn("[SECURITY] BENEFICIARY_JWT_SECRET غير مضبوط — يُستخدم JWT_SECRET كبديل. يُنصح بإعداد مفتاح منفصل.");
  }
  return new TextEncoder().encode(secret);
}

export interface BeneficiarySession {
  id: string;
  name: string;
  card_number: string;
  type: "beneficiary";
}

export async function beneficiaryLogin(data: Omit<BeneficiarySession, "type">) {
  const expires = new Date(Date.now() + EXPIRES_MS);
  const token = await new SignJWT({ ...data, type: "beneficiary" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getKey());

  (await cookies()).set(COOKIE_NAME, token, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export async function beneficiaryLogout() {
  (await cookies()).set(COOKIE_NAME, "", {
    expires: new Date(0),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export async function getBeneficiarySession(): Promise<BeneficiarySession | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ["HS256"] });
    if (payload.type !== "beneficiary") return null;
    return payload as unknown as BeneficiarySession;
  } catch {
    return null;
  }
}

/** يُستخدم في API routes (request مباشر) */
export async function getBeneficiarySessionFromRequest(req: Request): Promise<BeneficiarySession | null> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const { payload } = await jwtVerify(match[1], getKey(), { algorithms: ["HS256"] });
    if (payload.type !== "beneficiary") return null;
    return payload as unknown as BeneficiarySession;
  } catch {
    return null;
  }
}
