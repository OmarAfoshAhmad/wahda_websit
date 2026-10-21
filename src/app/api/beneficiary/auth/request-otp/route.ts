import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeLibyanMobile } from "@/lib/phone";
import { getOtpSettings } from "@/lib/system-settings";
import { normalizeCardInput } from "@/lib/card-number";
import { resolveFamilyAccountCard } from "@/lib/beneficiary-family";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  // ── CSRF Protection (Direct Origin Check) ──────────────
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "CSRF Attack Detected" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  // صيغة موحدة للهاتف (0912345678) حتى يطابق الرقم المسجل مهما كُتب (مسافات، 218…).
  const rawPhone = typeof body?.phone_number === "string" ? body.phone_number.trim() : "";
  const phone_number = normalizeLibyanMobile(rawPhone) ?? rawPhone;
  // الدخول بالشركة + الرقم الوظيفي (الجزء بعد رمز الشركة والسنة)، مع بقاء الدخول برقم البطاقة الكامل مدعومًا.
  let card_number = typeof body?.card_number === "string" ? normalizeCardInput(body.card_number) : "";

  // ── Rate Limiting (IP + Phone) ──────────────────────────
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipRateLimit = await checkRateLimit(`beneficiary-otp:${ip}`, "login");
  if (ipRateLimit) {
    return NextResponse.json({ error: ipRateLimit }, { status: 429 });
  }

  // تحويل الرقم الوظيفي بعد حد المعدل حتى لا يُستغل لتخمين الأرقام.
  if (!card_number && typeof body?.company_id === "string" && typeof body?.employee_number === "string") {
    // أي فرد من الأسرة يكتب رقمه، والرمز يذهب حصرًا إلى هاتف صاحب البطاقة الأساسية.
    const resolved = await resolveFamilyAccountCard(body.company_id, body.employee_number, phone_number);
    if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 401 });
    card_number = normalizeCardInput(resolved.cardNumber);
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
      const token = otpSettings.apiKey.trim();
      // الرابط الأساسي من توثيق رسالة: https://dev.resala.ly/api/v1 (يُقبل أيضًا مع مسار /pins أو /messages/send).
      const base = (otpSettings.apiUrl || "https://dev.resala.ly/api/v1").trim().replace(/\/+$/, "").replace(/\/(pins|messages\/send)$/, "");
      const headers = { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` };
      const reason = (body: Record<string, unknown>) => String(body.message ?? body.error ?? (body.errors ? JSON.stringify(body.errors) : "")).slice(0, 200);

      // 1) واجهة رموز التحقق (pins): رسالة تولّد الرمز وترسله وتعيده لنا فنحفظه للتحقق.
      const pinsUrl = new URL(`${base}/pins`);
      pinsUrl.searchParams.set("service_name", serviceName);
      let res = await fetch(pinsUrl, { method: "POST", headers, body: JSON.stringify({ phone: formattedPhone }) });
      let result: Record<string, unknown> = await res.json().catch(() => ({}));
      if (res.ok) {
        const data = (result.data ?? {}) as Record<string, unknown>;
        const generatedPin = result.pin ?? result.code ?? data.pin ?? data.code;
        if (generatedPin) code = String(generatedPin);
      } else {
        logger.warn("RESALA pins failed, trying messages/send", { status: res.status, reason: reason(result) });
        // 2) احتياط: إرسال رسالة نصية برمزنا نحن.
        const message = `رمز التفعيل الخاص بك في ${serviceName} هو: ${code}`;
        res = await fetch(`${base}/messages/send`, { method: "POST", headers, body: JSON.stringify([{ phone: formattedPhone, message }]) });
        result = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        logger.error("RESALA send failed", { status: res.status, reason: reason(result) });
        const detail = res.status === 401 ? "مفتاح API غير صحيح" : res.status === 403 ? "المفتاح بلا صلاحية إرسال أو اسم المرسل غير معتمد" : res.status === 402 ? "الرصيد غير كافٍ" : reason(result);
        return NextResponse.json({ error: `فشل الإرسال${detail ? `: ${detail}` : ": تأكد من الصلاحيات أو الرصيد"}` }, { status: 502 });
      }

      logger.info("OTP sent successfully");
    } catch (error) {
      logger.error("RESALA connection error", { error: error instanceof Error ? error.message : "Unknown" });
      return NextResponse.json({ error: "خطأ في الاتصال بمزود الرسائل" }, { status: 500 });
    }
  } else if (process.env.NODE_ENV === "production" && process.env.OTP_PREVIEW !== "true") {
    // في الإنتاج لا يُقبل وضع المحاكاة أو مزود غير مبرمج: الرمز لن يصل، فالأفضل خطأ واضح بدل صمت.
    logger.error("OTP provider not configured for production", { provider: otpSettings.provider });
    return NextResponse.json({ error: "خدمة الرسائل غير مفعّلة حاليًا. يرجى التواصل مع الدعم" }, { status: 503 });
  } else {
    // وضع المحاكاة (MOCK) — للتطوير والتجربة فقط
  }

  // ── 6. حفظ الرمز في قاعدة البيانات (بعد نجاح الإرسال) ──
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);
  await prisma.$executeRaw`
    INSERT INTO "OtpCode" ("id", "phone_number", "code", "expires_at", "is_used")
    VALUES (gen_random_uuid()::text, ${phone_number}, ${code}, ${expiresAt}, false)
  `;

  // معاينة الرمز للتجربة: فقط في وضع المحاكاة (بلا مزود رسائل) وعلى خادم التطوير أو خادم اختبار فُعّل فيه OTP_PREVIEW=true.
  const previewAllowed = otpSettings.provider !== "RESALA" && (process.env.NODE_ENV !== "production" || process.env.OTP_PREVIEW === "true");
  return NextResponse.json({
    status: "otp_sent",
    length,
    expiresIn: expiryMinutes * 60,
    ...(previewAllowed ? { previewCode: code } : {}),
  });
}
