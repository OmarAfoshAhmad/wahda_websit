// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const ROLLBACK = "__ROLLBACK_COMPANY_ARCHIVE_TEST__";

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!/(test|testing|snapshot)/i.test(databaseName)) {
    throw new Error(`Refusing to run against non-test database: ${databaseName}`);
  }

  const companies = await prisma.insuranceCompany.findMany({
    take: 2,
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (companies.length < 2) throw new Error("Two companies are required for this test");

  try {
    await prisma.$transaction(async (tx) => {
      const familyBaseCard = `SCOPE_TEST_${Date.now()}`;
      for (const [index, company] of companies.entries()) {
        await tx.familyImportArchive.create({
          data: {
            company_id: company.id,
            family_base_card: familyBaseCard,
            family_count_from_file: index + 1,
            total_balance_from_file: 1000 + index,
            used_balance_from_file: 100 + index,
            imported_by: "company-scope-test",
            last_imported_at: new Date(),
          },
        });
      }

      const both = await tx.familyImportArchive.findMany({ where: { family_base_card: familyBaseCard } });
      if (both.length !== 2) throw new Error(`Expected 2 isolated rows, found ${both.length}`);

      await tx.familyImportArchive.deleteMany({
        where: { company_id: companies[0].id, family_base_card: familyBaseCard },
      });
      const remaining = await tx.familyImportArchive.findMany({ where: { family_base_card: familyBaseCard } });
      if (remaining.length !== 1 || remaining[0].company_id !== companies[1].id) {
        throw new Error("Deleting one company archive affected the other company");
      }
      throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK) return;
    throw error;
  }
}

main()
  .then(() => console.log("FamilyImportArchive company isolation: PASS"))
  .finally(() => prisma.$disconnect());
