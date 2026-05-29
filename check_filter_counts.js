const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // 1. عدد البطاقات في جدول الحقيقة التي لا تطابق أي رقم بطاقة في المنظومة (بناءً على رقم البطاقة فقط)
  const countCardNumberOnly = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "CardIssuanceRegistryAll" f
    WHERE REGEXP_REPLACE(f.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') NOT IN (
      SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
    )
  `;
  
  // 2. عدد البطاقات بناءً على الفلتر الحالي (رقم البطاقة غير موجود + عدم وجود اسم وتاريخ ميلاد متطابق)
  const countCurrentFilter = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "CardIssuanceRegistryAll" f
    WHERE REGEXP_REPLACE(f.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') NOT IN (
      SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
    )
    AND (
      f.birth_date IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "Beneficiary" b2
        WHERE b2.deleted_at IS NULL
          AND b2.birth_date IS NOT NULL
          AND b2.birth_date::date = f.birth_date::date
          AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(b2.name, '')), '\\s+', ' ', 'g')) =
              UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g'))
      )
    )
  `;

  console.log("Card number only missing:", countCardNumberOnly);
  console.log("Current filter missing:", countCurrentFilter);
}

main().catch(console.error).finally(() => prisma.$disconnect());
