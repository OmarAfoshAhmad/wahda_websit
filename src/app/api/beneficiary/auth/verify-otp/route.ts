import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { beneficiaryLogin } from "@/lib/beneficiary-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeCardInput } from "@/lib/card-number";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;

export async function POST(req: NextRequest) {
  // ── CSRF Protection (Direct Origin Check) ──────────────
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "CSRF Attack Detected" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const card_number = typeof body?.card_number === "string" ? normalizeCardInput(body.card_number) : "";
  const phone_number = typeof body?.phone_number === "string" ? body.phone_number.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitError = await checkRateLimit(`beneficiary-otp-verify:${ip}`, "login");
  if (rateLimitError) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 });
  }

  if (!card_number || !phone_number || !code) {
    return NextResponse.json({ error: "رقم البطاقة، رقم الهاتف والرمز مطلوبان" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const cleanInput = card_number.replace(/[\s-]/g, "");

    const beneficiaries = await tx.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
      phone_number: string | null;
      failed_attempts: number;
      locked_until: Date | null;
    }>>`
      SELECT id, name, card_number, phone_number, failed_attempts, locked_until
      FROM "Beneficiary"
      WHERE REPLACE(REPLACE(UPPER(card_number), ' ', ''), '-', '') = UPPER(${cleanInput})
      AND "deleted_at" IS NULL
      LIMIT 1
      FOR UPDATE
    `;

    if (beneficiaries.length === 0) {
      return { type: "error" as const, status: 401, body: { error: "لم يتم العثور على حساب بهذا الرقم" } };
    }

    const beneficiary = beneficiaries[0];

    if (beneficiary.locked_until && beneficiary.locked_until.getTime() > Date.now()) {
      const minutesLeft = Math.ceil((beneficiary.locked_until.getTime() - Date.now()) / 60000);
      return { type: "error" as const, status: 429, body: { error: `الحساب محجوب مؤقتاً. حاول بعد ${minutesLeft} دقيقة` } };
    }

    // Verify phone number matches if it was already linked
    if (beneficiary.phone_number && beneficiary.phone_number !== phone_number) {
      return { type: "error" as const, status: 401, body: { error: "رقم الهاتف غير مطابق" } };
    }

    // Find the latest valid OTP (Raw SQL)
    const otps = await tx.$queryRaw<Array<{ id: string, code: string }>>`
      SELECT id, code
      FROM "OtpCode"
      WHERE phone_number = ${phone_number}
        AND is_used = false
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const validOtp = otps[0];

    if (!validOtp || validOtp.code !== code) {
      const newAttempts = beneficiary.failed_attempts + 1;
      const shouldLock = newAttempts >= MAX_ATTEMPTS;
      await tx.beneficiary.update({
        where: { id: beneficiary.id },
        data: {
          failed_attempts: newAttempts,
          locked_until: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : undefined,
        },
      });
      const remaining = MAX_ATTEMPTS - newAttempts;
      return {
        type: "error" as const,
        status: 401,
        body: { error: shouldLock ? `تم حجب الحساب لمدة ${LOCK_MINUTES} دقائق` : `الرمز غير صحيح. تبقى ${remaining} محاولة` },
      };
    }

    // Mark OTP as used (Raw SQL Bypass)
    await tx.$executeRaw`
      UPDATE "OtpCode"
      SET is_used = true
      WHERE id = ${validOtp.id}
    `;

    // If it was the first time logging in, Link the phone number!
    const updates: { failed_attempts: number; locked_until: null; phone_number?: string } = { failed_attempts: 0, locked_until: null };
    if (!beneficiary.phone_number) {
      updates.phone_number = phone_number;
    }

    await tx.beneficiary.update({
      where: { id: beneficiary.id },
      data: updates,
    });

    return { type: "success" as const, beneficiary: { id: beneficiary.id, name: beneficiary.name, card_number: beneficiary.card_number } };
  });

  if (result.type === "error") {
    return NextResponse.json(result.body, { status: result.status });
  }

  await beneficiaryLogin(result.beneficiary);
  return NextResponse.json({ status: "ok" });
}
