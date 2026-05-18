import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOtpSettings } from "@/lib/system-settings";
import { normalizeCardInput } from "@/lib/card-number";
import { logger } from "@/lib/logger";

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

  // ── Rate Limiting (IP + Phone) ──────────────────────────
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipRateLimit = await checkRateLimit(`beneficiary-otp:${ip}`, "login");
  if (ipRateLimit) {
    return NextResponse.json({ error: ipRateLimit }, { status: 429 });
  }

  if (!card_number || !phone_number) {
    return NextResponse.json({ error: "رقم البطاقة ورقم الهاتف مطلوبان" }, { status: 400 });
  }

  const phoneRateLimit = await checkRateLimit(`beneficiary-otp-phone:${phone_number}`, "login");
  if (phoneRateLimit) {
    return NextResponse.json({ error: "تم إرسال رمز مؤخراً. يرجى الانتظار قبل المحاولة مجدداً" }, { status: 429 });
  }

  // ── 1. البحث عن المستفيد ──────────────────────────────
  const cleanInput = card_number.replace(/[\s-]/g, "");

  const beneficiaries = await prisma.$queryRaw<Array<{
    id: string;
    phone_number: string | null;
    locked_until: Date | null;
  }>>`
    SELECT id, phone_number, locked_until
    FROM "Beneficiary"
    WHERE REPLACE(REPLACE(UPPER(card_number), ' ', ''), '-', '') = UPPER(${cleanInput})
    AND "deleted_at" IS NULL
    LIMIT 1
  `;

  if (beneficiaries.length === 0) {
    return NextResponse.json({ error: "لم يتم العثور على بطاقة بهذا الرقم" }, { status: 401 });
  }

  const beneficiary = beneficiaries[0];

  if (beneficiary.locked_until && beneficiary.locked_until.getTime() > Date.now()) {
    const minutesLeft = Math.ceil((beneficiary.locked_until.getTime() - Date.now()) / 60000);
    return NextResponse.json({ error: `الحساب محجوب مؤقتاً. حاول بعد ${minutesLeft} دقيقة` }, { status: 429 });
  }

  // ── 2. منطق الهاتف: تسجيل أول مرة أو تحقق من التطابق ──
  if (beneficiary.phone_number) {
    // ─ البطاقة مسجّلة مسبقاً برقم هاتف — يجب أن يتطابق
    if (beneficiary.phone_number !== phone_number) {
      return NextResponse.json(
        { error: "رقم الهاتف غير مطابق للرقم المسجل لهذه البطاقة" },
        { status: 401 }
      );
    }
  } else {
    // ─ أول تسجيل: تحقق أن الهاتف غير مستخدم مع بطاقة أخرى
    const phoneConflict = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Beneficiary"
      WHERE phone_number = ${phone_number}
        AND id != ${beneficiary.id}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (phoneConflict.length > 0) {
      return NextResponse.json(
        { error: "رقم الهاتف مستخدم مع بطاقة أخرى. يرجى التواصل مع الدعم" },
        { status: 409 }
      );
    }

    // ─ ربط رقم الهاتف بالبطاقة (تسجيل أول مرة)
    await prisma.$executeRaw`
      UPDATE "Beneficiary"
      SET phone_number = ${phone_number}
      WHERE id = ${beneficiary.id}
    `;
  }

  // ── 3. توليد رمز OTP آمن تشفيرياً ─────────────────────
  const otpSettings = await getOtpSettings();
  const length = otpSettings.otpLength || 6;
  const expiryMinutes = otpSettings.otpExpiry || 5;

  const digits: number[] = [];
  for (let i = 0; i < length; i++) {
    digits.push(randomInt(0, 10));
  }
  let code = digits.join("");

  // ── 4. تنظيف الرموز المنتهية تلقائياً ─────────────────
  await prisma.$executeRaw`
    DELETE FROM "OtpCode"
    WHERE expires_at < NOW() OR (is_used = true AND created_at < NOW() - INTERVAL '1 hour')
  `.catch(() => { /* تنظيف اختياري — لا نوقف العملية إذا فشل */ });

  // ── 5. إرسال الرمز عبر المزود ─────────────────────────
  if (otpSettings.provider === "RESALA") {
    try {
      let formattedPhone = phone_number.trim();
      if (formattedPhone.startsWith("0")) formattedPhone = "218" + formattedPhone.substring(1);
      if (!formattedPhone.startsWith("218")) formattedPhone = "218" + formattedPhone;

      const serviceName = otpSettings.senderId || otpSettings.facilityName || "بوابة المستفيد";
      const message = `رمز التفعيل الخاص بك في ${serviceName} هو: ${code}`;
      const token = otpSettings.apiKey.trim();
      const apiUrl = otpSettings.apiUrl || "https://api.resala.ly/api/v1/messages/send";

      // المحاولة الأولى: إرسال مباشر
      let res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "x-api-key": token,
        },
        body: JSON.stringify([{ phone: formattedPhone, message }]),
      });

      let result = await res.json().catch(() => ({}));

      // المحاولة الثانية: Pins API (إذا فشل الإرسال المباشر)
      if (!res.ok && (res.status === 403 || res.status === 401)) {
        logger.warn("RESALA direct send failed, switching to PINS API fallback");

        const pinsUrl = apiUrl.includes("/pins") ? apiUrl : apiUrl.replace("/messages/send", "/pins");

        let finalPinsUrl = pinsUrl;
        try {
          const urlObj = new URL(pinsUrl);
          urlObj.searchParams.set("service_name", serviceName);
          finalPinsUrl = urlObj.toString();
        } catch {
          finalPinsUrl += (pinsUrl.includes("?") ? "&" : "?") + `service_name=${encodeURIComponent(serviceName)}`;
        }

        const resPins = await fetch(finalPinsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ phone: formattedPhone }),
        });

        if (resPins.ok) {
          res = resPins;
          result = await resPins.json().catch(() => ({}));

          // مزامنة الرمز الذي ولّدته الشركة مع قاعدة بياناتنا
          const generatedPin = result.pin || result.code || result.data?.pin;
          if (generatedPin) {
            code = generatedPin.toString();
            logger.info("RESALA provider-generated PIN synced to local DB");
          }
        }
      }

      if (!res.ok) {
        logger.error("RESALA send failed", { status: res.status });
        return NextResponse.json({
          error: result.message || "فشل الإرسال: تأكد من الصلاحيات أو الرصيد",
        }, { status: res.status });
      }

      logger.info("OTP sent successfully");
    } catch (error) {
      logger.error("RESALA connection error", { error: error instanceof Error ? error.message : "Unknown" });
      return NextResponse.json({ error: "خطأ في الاتصال بمزود الرسائل" }, { status: 500 });
    }
  } else {
    // وضع المحاكاة (MOCK) — للتطوير فقط
  }

  // ── 6. حفظ الرمز في قاعدة البيانات (بعد نجاح الإرسال) ──
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  await prisma.$executeRaw`
    INSERT INTO "OtpCode" ("id", "phone_number", "code", "expires_at", "is_used")
    VALUES (gen_random_uuid()::text, ${phone_number}, ${code}, ${expiresAt}, false)
  `;

  return NextResponse.json({
    status: "otp_sent",
    length,
    expiresIn: expiryMinutes * 60,
  });
}
