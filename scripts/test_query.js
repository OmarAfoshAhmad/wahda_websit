const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['query', 'info', 'warn', 'error'] });

async function main() {
  console.log("Starting query test...");
  const startTime = Date.now();
  
  try {
    const result = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::bigint AS count
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          AND (
            NOT EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" __t_insys
                  WHERE __t_insys.canonical_card =
                        REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\\\1')
                )
              AND (
                "Beneficiary".birth_date IS NULL
                OR NOT EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" t2
                  WHERE t2.birth_date IS NOT NULL
                    AND t2.birth_date::date = "Beneficiary".birth_date::date
                    AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                        UPPER(REGEXP_REPLACE(BTRIM("Beneficiary".name), '\\s+', ' ', 'g'))
                )
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
