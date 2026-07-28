// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");

function assertIsolatedDatabase(url) {
  if (!url) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required");
  const databaseName = new URL(url).pathname.replace(/^\//, "").toLowerCase();
  if (!/(test|testing|snapshot)/.test(databaseName)) {
    throw new Error(`Refusing to audit non-isolated database: ${databaseName}`);
  }
  return databaseName;
}

async function main() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const databaseName = assertIsolatedDatabase(url);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        fia.family_base_card,
        COUNT(b.id)::int AS beneficiary_count,
        COUNT(b.id) FILTER (WHERE b.company_id IS NULL)::int AS null_company_count,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT b.company_id), NULL) AS company_ids
      FROM "FamilyImportArchive" fia
      LEFT JOIN "Beneficiary" b
        ON b.deleted_at IS NULL
       AND LEFT(UPPER(BTRIM(b.card_number)), LENGTH(UPPER(BTRIM(fia.family_base_card)))) = UPPER(BTRIM(fia.family_base_card))
      GROUP BY fia.family_base_card
      ORDER BY fia.family_base_card
    `);

    const classified = rows.map((row) => {
      const companyIds = Array.isArray(row.company_ids) ? row.company_ids.filter(Boolean) : [];
      const beneficiaryCount = Number(row.beneficiary_count || 0);
      const nullCompanyCount = Number(row.null_company_count || 0);
      let category;
      if (beneficiaryCount === 0) category = "UNMATCHED";
      else if (companyIds.length === 1 && nullCompanyCount === 0) category = "SAFE_SINGLE_COMPANY";
      else if (companyIds.length > 1) category = "MULTI_COMPANY_CONFLICT";
      else category = "HAS_NULL_COMPANY";
      return {
        familyBaseCard: row.family_base_card,
        beneficiaryCount,
        nullCompanyCount,
        companyIds,
        category,
      };
    });

    const summary = classified.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] || 0) + 1;
      return acc;
    }, {});

    console.log(JSON.stringify({
      databaseName,
      totalArchiveRows: classified.length,
      summary,
      unsafeRows: classified.filter((row) => row.category !== "SAFE_SINGLE_COMPANY"),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
