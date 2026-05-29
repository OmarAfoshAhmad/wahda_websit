const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query', 'info', 'warn', 'error'] });

async function main() {
  try {
    const result = await prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS count
      FROM "CardIssuanceRegistryAll"
      WHERE 1=1 
        ${Prisma.sql`AND (NOT EXISTS (
            SELECT 1
            FROM "Beneficiary" __b_missing
            WHERE __b_missing.deleted_at IS NULL
              AND REGEXP_REPLACE(UPPER(BTRIM(__b_missing.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\\\1') =
                  canonical_card
          )
          AND (
            birth_date IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM "Beneficiary" b2
              WHERE b2.deleted_at IS NULL
                AND b2.birth_date IS NOT NULL
                AND b2.birth_date::date = birth_date::date
                AND UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\\\s+', ' ', 'g')) =
                    UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\\\s+', ' ', 'g'))
            )
          )
        )`}
    `;
    console.log("Success!", result);
  } catch (err) {
    console.error("Syntax Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
