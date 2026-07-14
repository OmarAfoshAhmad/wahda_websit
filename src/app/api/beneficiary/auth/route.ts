import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { beneficiaryLogin } from "@/lib/beneficiary-auth";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeCardInput } from "@/lib/card-number";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
const GENERIC_AUTH_ERROR = "بيانات الدخول غير صحيحة";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const card_number = typeof body?.card_number === "string" ? normalizeCardInput(body.card_number) : "";
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitError = await checkRateLimit(`beneficiary-login:${ip}`, "login");
  if (rateLimitError) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 });
  }

  if (!card_number) {
    return NextResponse.json({ error: "رقم البطاقة مطلوب" }, { status: 400 });
  }

  // استخدام transaction مع SELECT FOR UPDATE لمنع race condition
  const result = await prisma.$transaction(async (tx) => {
    const beneficiaries = await tx.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
      pin_hash: string | null;
      failed_attempts: number;
      locked_until: Date | null;
    }>>`
      SELECT id, name, card_number, pin_hash, failed_attempts, locked_until
      FROM "Beneficiary"
      WHERE UPPER(BTRIM(card_number)) = UPPER(BTRIM(${card_number}))
      AND "deleted_at" IS NULL
      LIMIT 1
      FOR UPDATE
    `;

    if (beneficiaries.length === 0) {
      return { type: "error" as const, status: 401, body: { error: GENERIC_AUTH_ERROR } };
    }

    const beneficiary = beneficiaries[0];

    // فحص الحجب
    if (beneficiary.locked_until && beneficiary.locked_until.getTime() > Date.now()) {
      const minutesLeft = Math.ceil((beneficiary.locked_until.getTime() - Date.now()) / 60000);
      return { type: "error" as const, status: 429, body: { error: `الحساب محجوب مؤقتاً. حاول بعد ${minutesLeft} دقيقة` } };
    }

    // لا يوجد PIN بعد → اطلب الإعداد
    if (!beneficiary.pin_hash) {
      return { type: "status" as const, body: { status: "needs_setup" } };
    }

    // يجب تقديم PIN إذا كان موجوداً
    if (!pin || pin.length !== 6) {
      return { type: "status" as const, body: { status: "needs_pin" } };
    }

    const valid = await bcrypt.compare(pin, beneficiary.pin_hash);

    if (!valid) {
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
        body: { error: shouldLock ? `تم حجب الحساب لمدة ${LOCK_MINUTES} دقائق` : `${GENERIC_AUTH_ERROR}. تبقى ${remaining} محاولة` },
      };
    }

    // ناجح — إعادة تعيين المحاولات
    await tx.beneficiary.update({
      where: { id: beneficiary.id },
      data: { failed_attempts: 0, locked_until: null },
    });

    return { type: "success" as const, beneficiary: { id: beneficiary.id, name: beneficiary.name, card_number: beneficiary.card_number } };
  });

  if (result.type === "error") {
    return NextResponse.json(result.body, { status: result.status });
  }
  if (result.type === "status") {
    return NextResponse.json(result.body);
  }

  await beneficiaryLogin(result.beneficiary);
  return NextResponse.json({ status: "ok" });
}
