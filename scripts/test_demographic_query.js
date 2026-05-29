const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query', 'info', 'warn', 'error'] });

async function main() {
  console.log("Starting demographic mismatch query test...");
  const startTime = Date.now();
  
  try {
    const result = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::bigint AS count
        FROM "CardIssuanceRegistryAll"
        WHERE 
            EXISTS (
                  SELECT 1
                  FROM "Beneficiary" b
                  WHERE b.deleted_at IS NULL
                    AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\\\1') =
                        canonical_card
                    AND (
                      UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\\\s+', ' ', 'g')) <>
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\\\s+', ' ', 'g'))
                      OR (b.birth_date IS NOT NULL AND birth_date IS NOT NULL AND b.birth_date::date <> birth_date::date)
                      OR (b.birth_date IS NULL AND birth_date IS NOT NULL)
                      OR (b.birth_date IS NOT NULL AND birth_date NULL)
                    )
                )
    `);
    
    console.log("Query Result:", result);
    console.log("Execution Time:", Date.now() - startTime, "ms");
  } catch (err) {
    console.error("Query failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
