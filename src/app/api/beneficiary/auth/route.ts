import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { beneficiaryLogin } from "@/lib/beneficiary-auth";
import { resolveFamilyAccountCard } from "@/lib/beneficiary-family";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
const GENERIC_AUTH_ERROR = "الرقم الوظيفي أو كلمة المرور غير صحيحة";

/**
 * الدخول بالشركة + الرقم الوظيفي + كلمة مرور الأسرة (6 أرقام). أي فرد من الأسرة يدخل بها،
 * والجلسة تبدأ على صاحب البطاقة الأساسية ثم يختار الفرد الذي يُطلب له الدواء.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "طلب غير مسموح" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const companyId = typeof body?.company_id === "string" ? body.company_id : "";
  const employeeNumber = typeof body?.employee_number === "string" ? body.employee_number : "";
  const password = typeof body?.password === "string" ? body.password.trim() : "";
  if (!companyId || !employeeNumber || !/^\d{6}$/.test(password)) {
    return NextResponse.json({ error: "اختر الشركة واكتب الرقم الوظيفي وكلمة المرور (6 أرقام)" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitError = await checkRateLimit(`beneficiary-login:${ip}`, "login");
  if (rateLimitError) return NextResponse.json({ error: rateLimitError }, { status: 429 });

  const resolved = await resolveFamilyAccountCard(companyId, employeeNumber, "");
  if ("error" in resolved) return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; name: string; card_number: string; pin_hash: string | null; failed_attempts: number; locked_until: Date | null }>>`
      SELECT id, name, card_number, pin_hash, failed_attempts, locked_until
      FROM "Beneficiary"
      WHERE card_number = ${resolved.cardNumber} AND company_id = ${companyId} AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `;
    const account = rows[0];
    if (!account) return { status: 401, body: { error: GENERIC_AUTH_ERROR } } as const;

    if (account.locked_until && account.locked_until.getTime() > Date.now()) {
      const minutesLeft = Math.ceil((account.locked_until.getTime() - Date.now()) / 60000);
      return { status: 429, body: { error: `الحساب محجوب مؤقتاً. حاول بعد ${minutesLeft} دقيقة` } } as const;
    }
    if (!account.pin_hash) {
      return { status: 409, body: { error: "لم تُنشأ كلمة مرور لهذه الأسرة بعد. ادخل برمز التحقق أول مرة", status: "needs_setup" } } as const;
    }

    if (!(await bcrypt.compare(password, account.pin_hash))) {
      const attempts = account.failed_attempts + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await tx.beneficiary.update({
        where: { id: account.id },
        data: { failed_attempts: attempts, locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : undefined },
      });
      return { status: 401, body: { error: lock ? `تم حجب الحساب لمدة ${LOCK_MINUTES} دقائق` : `${GENERIC_AUTH_ERROR}. تبقى ${MAX_ATTEMPTS - attempts} محاولة` } } as const;
    }

    await tx.beneficiary.update({ where: { id: account.id }, data: { failed_attempts: 0, locked_until: null } });
    return { status: 200, account } as const;
  });

  if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });
  const { account } = result;
  await beneficiaryLogin({ id: account.id, name: account.name, card_number: account.card_number, account_id: account.id, auth: "password" });
  return NextResponse.json({ status: "ok" });
}
