import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { beneficiaryLogin } from "@/lib/beneficiary-auth";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeCardInput } from "@/lib/card-number";

const GENERIC_AUTH_ERROR = "بيانات الدخول غير صحيحة";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const card_number = typeof body?.card_number === "string" ? normalizeCardInput(body.card_number) : "";
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  const confirm_pin = typeof body?.confirm_pin === "string" ? body.confirm_pin.trim() : "";

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitError = await checkRateLimit(`beneficiary-setup-pin:${ip}`, "login");
  if (rateLimitError) {
    return NextResponse.json({ error: rateLimitError }, { status: 429 });
  }

  if (!card_number || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  if (pin !== confirm_pin) {
    return NextResponse.json({ error: "رمز PIN غير متطابق" }, { status: 400 });
  }

  // استخدام transaction مع SELECT FOR UPDATE لمنع race condition
  const result = await prisma.$transaction(async (tx) => {
    const beneficiaries = await tx.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
      pin_hash: string | null;
    }>>`
      SELECT id, name, card_number, pin_hash
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

    // منع التعيين مرة ثانية (يجب المرور بالمشرف لإعادة التعيين)
    if (beneficiary.pin_hash) {
      return { type: "error" as const, status: 409, body: { error: "تم تعيين رمز PIN مسبقاً" } };
    }

    const pin_hash = await bcrypt.hash(pin, 12);
    await tx.beneficiary.update({
      where: { id: beneficiary.id },
      data: { pin_hash, failed_attempts: 0, locked_until: null },
    });

    return { type: "success" as const, beneficiary: { id: beneficiary.id, name: beneficiary.name, card_number: beneficiary.card_number } };
  });

  if (result.type === "error") {
    return NextResponse.json(result.body, { status: result.status });
  }

  await beneficiaryLogin(result.beneficiary);
  return NextResponse.json({ status: "ok" });
}
