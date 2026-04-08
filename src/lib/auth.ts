import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function getJwtKey() {
  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return new TextEncoder().encode(secretKey);
}

export async function encrypt(payload: Record<string, unknown>) {
  const key = getJwtKey();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key);
}

export async function decrypt(input: string): Promise<Record<string, unknown>> {
  const key = getJwtKey();
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  return payload;
}

export type ManagerPermissions = {
  import_beneficiaries: boolean;
  add_beneficiary: boolean;
  edit_beneficiary: boolean;
  delete_beneficiary: boolean;
  add_facility: boolean;
  edit_facility: boolean;
  delete_facility: boolean;
  cancel_transactions: boolean;
  correct_transactions: boolean;
  manage_recycle_bin: boolean;
  export_data: boolean;
  print_cards: boolean;
  view_audit_log: boolean;
  view_reports: boolean;
  view_facilities: boolean;
  view_beneficiaries: boolean;
  deduct_balance: boolean;
  delete_transaction: boolean;
};

export async function login(user: {
  id: string;
  name: string;
  username: string;
  is_admin: boolean;
  is_manager: boolean;
  manager_permissions: ManagerPermissions | null;
  must_change_password: boolean;
}) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session = await encrypt(user as unknown as Record<string, unknown>);

  (await cookies()).set("session", session, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export async function logout() {
  (await cookies()).set("session", "", {
    expires: new Date(0),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

export interface Session {
  id: string;
  name: string;
  username: string;
  is_admin: boolean;
  is_manager: boolean;
  manager_permissions: ManagerPermissions | null;
  must_change_password: boolean;
  expires?: Date;
}

export async function getSession(): Promise<Session | null> {
  const session = (await cookies()).get("session")?.value;
  if (!session) return null;
  try {
    return await decrypt(session) as unknown as Session;
  } catch {
    return null;
  }
}

export async function updateSession(request: NextRequest) {
  const session = request.cookies.get("session")?.value;
  if (!session) return;

  // FIX SEC-03: JWT فاسد (تلاعب أو انتهاء المفتاح) يجب ألا يُسقط الـ middleware
  try {
    const parsed = await decrypt(session);
    parsed.expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const res = NextResponse.next();
    res.cookies.set({
      name: "session",
      value: await encrypt(parsed as Record<string, unknown>),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: parsed.expires as Date,
    });
    return res;
  } catch {
    // JWT فاسد أو منتهي — نتجاهل تجديده بصمت (المستخدم سيُعاد توجيهه عند الطلب التالي)
    return;
  }
}
