const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const beneficiaryLegacyActive = await prisma.beneficiary.count({
    where: { deleted_at: null, is_legacy_card: true }
  });

  const rawLegacyInRegistryAll = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS count
    FROM "CardIssuanceRegistryAll" r
    WHERE REGEXP_REPLACE(r.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') IN (
      SELECT REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
      FROM "Beneficiary" b
      WHERE b.deleted_at IS NULL AND b.is_legacy_card = true
    )
  `;

  // Count active legacy cards that do NOT have a match in CardIssuanceRegistryAll
  const rawLegacyNotInRegistryAll = await prisma.$queryRaw`
    SELECT COUNT(*)::integer AS count
    FROM "Beneficiary" b
    WHERE b.deleted_at IS NULL AND b.is_legacy_card = true
      AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') NOT IN (
        SELECT REGEXP_REPLACE(r.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
        FROM "CardIssuanceRegistryAll" r
      )
  `;

  console.log({
    beneficiaryLegacyActive,
    hasBatchInRegistry: rawLegacyInRegistryAll[0].count,
    noBatchInRegistry: rawLegacyNotInRegistryAll[0].count,
    totalMath: rawLegacyInRegistryAll[0].count + rawLegacyNotInRegistryAll[0].count
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
