import prisma from "@/lib/prisma";

/**
 * الرقم الوظيفي = ما بعد رمز الشركة والسنة في رقم البطاقة.
 * أمثلة: JMR202510540W1 → 10540W1، ARCAD20250012F1 → 0012F1، O3G20250006 → 0006.
 * السنة تبدأ دائمًا بـ 20، ورمز الشركة قد يحتوي أرقامًا (O3G)، لذا المطابقة غير جشعة حتى أول "20xx".
 */
export const EMPLOYEE_NUMBER_SQL_PATTERN = "^[A-Z][A-Z0-9]*?20[0-9]{2}";

export function normalizeEmployeeNumber(value: string) {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function employeeNumberOf(cardNumber: string) {
  return cardNumber.toUpperCase().replace(/^[A-Z][A-Z0-9]*?20\d{2}/, "");
}

/**
 * يحوّل (الشركة + الرقم الوظيفي) إلى رقم البطاقة الكامل.
 * الرقم الوظيفي قد يتكرر بين الشركات، لذا الشركة إلزامية. وإن تكرر داخل الشركة نفسها
 * (أخطاء إدخال قديمة) يُحسم برقم الهاتف المسجل إن طابق.
 */
export async function resolveCardByEmployeeNumber(companyId: string, employeeNumber: string, phone: string) {
  const normalized = normalizeEmployeeNumber(employeeNumber);
  if (!companyId || !/^[A-Z0-9]{1,20}$/.test(normalized)) return { error: "أدخل الرقم الوظيفي كما هو في بطاقتك" } as const;
  const matches = await prisma.$queryRaw<Array<{ card_number: string; phone_number: string | null }>>`
    SELECT card_number, phone_number FROM "Beneficiary"
    WHERE company_id = ${companyId}
      AND deleted_at IS NULL
      -- الأصفار البادئة لا تُحتسب: 001 = 1 = 000001 (الفروسية مثلًا SJR2026000001)
      AND regexp_replace(regexp_replace(UPPER(REPLACE(REPLACE(card_number, ' ', ''), '-', '')), ${EMPLOYEE_NUMBER_SQL_PATTERN}, ''), '^0+(?=.)', '') = ${normalized.replace(/^0+(?=.)/, "")}
    LIMIT 5
  `;
  if (matches.length === 0) return { error: "لم يتم العثور على هذا الرقم الوظيفي في الشركة المختارة" } as const;
  if (matches.length === 1) return { cardNumber: matches[0].card_number } as const;
  const byPhone = matches.filter((match) => match.phone_number && match.phone_number === phone);
  if (byPhone.length === 1) return { cardNumber: byPhone[0].card_number } as const;
  return { error: "هذا الرقم الوظيفي مسجل لأكثر من مستفيد. يرجى التواصل مع الدعم" } as const;
}

/** قائمة الشركات لشاشة الدخول، مع مثال على بادئة البطاقة (رمز الشركة + السنة) لإرشاد المستفيد. */
export async function listCompaniesForLogin() {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; logo: string | null; prefix: string | null }>>`
    SELECT c.id, c.name, c.logo,
      (SELECT substring(UPPER(b.card_number) from '^([A-Z][A-Z0-9]*?20[0-9]{2})')
         FROM "Beneficiary" b WHERE b.company_id = c.id AND b.deleted_at IS NULL
         GROUP BY 1 ORDER BY count(*) DESC LIMIT 1) AS prefix
    FROM "InsuranceCompany" c
    WHERE c.deleted_at IS NULL AND c.is_active = true
    ORDER BY c.name
  `;
  return rows.filter((row) => row.prefix);
}
