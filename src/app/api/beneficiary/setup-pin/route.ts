import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";

/** تعيين كلمة المرور مسموح فقط بعد التحقق برمز OTP حديث وصل إلى هاتف صاحب البطاقة. */
const OTP_WINDOW_MS = 15 * 60 * 1000;

/**
 * يعيّن كلمة مرور الأسرة (6 أرقام) على حساب صاحب البطاقة الأساسية: أول مرة، أو عند نسيانها.
 * لا يقبل رقم بطاقة من الطلب؛ الحساب يؤخذ من جلسة دخلت برمز التحقق.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "طلب غير مسموح" }, { status: 403 });
  }

  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "انتهت الجلسة. ادخل برمز التحقق" }, { status: 401 });
  if (session.auth !== "otp" || !session.otp_at || Date.now() - session.otp_at > OTP_WINDOW_MS) {
    return NextResponse.json({ error: "لتغيير كلمة المرور ادخل برمز التحقق المرسل إلى هاتف صاحب البطاقة" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password.trim() : "";
  const confirm = typeof body?.confirm_password === "string" ? body.confirm_password.trim() : "";
  if (!/^\d{6}$/.test(password)) return NextResponse.json({ error: "كلمة المرور 6 أرقام" }, { status: 400 });
  if (password !== confirm) return NextResponse.json({ error: "كلمتا المرور غير متطابقتين" }, { status: 400 });
  if (/^(\d)\1{5}$/.test(password) || "0123456789".includes(password) || "9876543210".includes(password)) {
    return NextResponse.json({ error: "اختر كلمة مرور أصعب من أرقام متكررة أو متتالية" }, { status: 400 });
  }

  await prisma.beneficiary.update({
    where: { id: session.account_id ?? session.id },
    data: { pin_hash: await bcrypt.hash(password, 12), failed_attempts: 0, locked_until: null },
  });
  return NextResponse.json({ status: "ok" });
}
