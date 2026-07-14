const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function familyBase(card) {
  return String(card || "").replace(/([WSDMFHV][0-9]*)$/i, "");
}

async function main() {
  const card = process.argv[2] || "WAB20253819";
  const base = familyBase(card);

  const b = await prisma.beneficiary.findFirst({
    where: { card_number: card },
    select: {
      id: true,
      name: true,
      card_number: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      created_at: true,
    },
  });

  console.log("=== BENEFICIARY ===");
  console.log(
    JSON.stringify(
      b
        ? {
            ...b,
            total_balance: Number(b.total_balance),
            remaining_balance: Number(b.remaining_balance),
          }
        : null,
      null,
      2,
    ),
  );

  const familyRegex = `^${base}[WSDMFHV][0-9]*$`;

  const familyByRegex = await prisma.$queryRaw`
    SELECT
      id,
      name,
      card_number,
      total_balance::float8 AS total_balance,
      remaining_balance::float8 AS remaining_balance,
      status::text
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND (
        card_number = ${base}
        OR card_number ~ ${familyRegex}
      )
    ORDER BY card_number
  `;

  const familyByLike = await prisma.$queryRaw`
    SELECT
      id,
      name,
      card_number,
      total_balance::float8 AS total_balance,
      remaining_balance::float8 AS remaining_balance,
      status::text
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND card_number LIKE ${base + "%"}
    ORDER BY card_number
  `;

  console.log("=== FAMILY BY REGEX ===", familyByRegex.length);
  console.log(JSON.stringify(familyByRegex, null, 2));
  console.log("=== FAMILY BY LIKE ===", familyByLike.length);

  const archive = await prisma.$queryRaw`
    SELECT
      "family_base_card",
      "family_count_from_file"::int AS family_count_from_file,
      "total_balance_from_file"::float8 AS total_balance_from_file,
      "used_balance_from_file"::float8 AS used_balance_from_file,
      "source_row_number"::int AS source_row_number,
      "imported_by",
      "last_imported_at"
    FROM "FamilyImportArchive"
    WHERE "family_base_card" = ${base}
    LIMIT 1
  `;

  console.log("=== ARCHIVE ===");
  console.log(JSON.stringify(archive, null, 2));

  const tx = await prisma.transaction.findMany({
    where: {
      beneficiary: { card_number: card },
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    select: {
      id: true,
      type: true,
      amount: true,
      created_at: true,
      facility: { select: { name: true } },
    },
    orderBy: { created_at: "desc" },
    take: 30,
  });

  console.log("=== TX ===");
  for (const t of tx) {
    console.log(
      t.id,
      t.type,
      Number(t.amount),
      t.created_at.toISOString(),
      t.facility?.name || "",
    );
  }

  const latestImportLog = await prisma.auditLog.findFirst({
    where: { action: "IMPORT_TRANSACTIONS" },
    orderBy: { created_at: "desc" },
    select: { id: true, created_at: true, user: true, metadata: true },
  });

  console.log("=== LATEST_IMPORT_LOG ===");
  console.log(
    latestImportLog
      ? `${latestImportLog.id} ${latestImportLog.created_at.toISOString()} ${latestImportLog.user}`
      : "none",
  );

  const applied = Array.isArray(latestImportLog?.metadata?.appliedRows)
    ? latestImportLog.metadata.appliedRows
    : [];
  const hits = applied.filter(
    (r) => String(r.cardNumber || "") === card || String(r.familyBaseCard || "") === base,
  );

  console.log("=== APPLIED HITS ===", hits.length);
  console.log(JSON.stringify(hits, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
