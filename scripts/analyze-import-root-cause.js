const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function familyBase(card) {
  return String(card || "").replace(/([WSDMFHV][0-9]*)$/i, "");
}

async function main() {
  const cards = ["WAB20254251", "WAB2025104775"];

  const beneficiaries = await prisma.beneficiary.findMany({
    where: { card_number: { in: cards } },
    select: {
      id: true,
      card_number: true,
      name: true,
      total_balance: true,
      remaining_balance: true,
      created_at: true,
    },
  });

  console.log("=== BENEFICIARIES ===");
  for (const b of beneficiaries) {
    console.log(
      JSON.stringify(
        {
          ...b,
          total_balance: Number(b.total_balance),
          remaining_balance: Number(b.remaining_balance),
        },
        null,
        2,
      ),
    );
  }

  const bases = [...new Set(beneficiaries.map((b) => familyBase(b.card_number)))];
  console.log("=== FAMILY BASES ===", bases);

  for (const base of bases) {
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

    console.log("=== ARCHIVE FOR", base, "===");
    console.log(JSON.stringify(archive, null, 2));
  }

  const importTransactions = await prisma.transaction.findMany({
    where: {
      type: "IMPORT",
      is_cancelled: false,
      beneficiary: { card_number: { in: cards } },
    },
    select: {
      id: true,
      amount: true,
      created_at: true,
      beneficiary: { select: { id: true, card_number: true, name: true } },
      facility: { select: { id: true, name: true } },
    },
    orderBy: { created_at: "desc" },
  });

  console.log("=== IMPORT TX FOR TARGET CARDS ===");
  for (const t of importTransactions) {
    console.log(
      t.id,
      t.beneficiary.card_number,
      Number(t.amount),
      t.created_at.toISOString(),
      t.facility?.name || "",
    );
  }

  const firstTs = importTransactions.length
    ? new Date(Math.min(...importTransactions.map((t) => t.created_at.getTime())))
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const lastTs = importTransactions.length
    ? new Date(Math.max(...importTransactions.map((t) => t.created_at.getTime())))
    : new Date();

  const nearbyLogs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["IMPORT_TRANSACTIONS", "SETTLE_OVERDRAWN_FAMILY_DEBT"] },
      created_at: {
        gte: new Date(firstTs.getTime() - 15 * 60 * 1000),
        lte: new Date(lastTs.getTime() + 15 * 60 * 1000),
      },
    },
    select: { id: true, action: true, user: true, created_at: true, metadata: true },
    orderBy: { created_at: "desc" },
  });

  console.log("=== NEARBY AUDIT LOGS ===");
  for (const l of nearbyLogs) {
    console.log(l.id, l.action, l.user, l.created_at.toISOString());
  }

  const latestImportLog = nearbyLogs.find((l) => l.action === "IMPORT_TRANSACTIONS");
  if (!latestImportLog) {
    console.log("No IMPORT_TRANSACTIONS log found near target transactions.");
    return;
  }

  const appliedRows = Array.isArray(latestImportLog.metadata?.appliedRows)
    ? latestImportLog.metadata.appliedRows
    : [];

  const matchedApplied = appliedRows.filter((r) => cards.includes(String(r.cardNumber || "")));

  console.log("=== APPLIED ROWS MATCHED ===");
  console.log(JSON.stringify(matchedApplied, null, 2));

  const familySummary = new Map();
  for (const row of appliedRows) {
    const key = String(row.familyBaseCard || "");
    if (!key) continue;
    if (!familySummary.has(key)) {
      familySummary.set(key, {
        familyBaseCard: key,
        familySize: row.familySize,
        familyTotalDeduction: row.familyTotalDeduction,
        rows: 0,
      });
    }
    const ref = familySummary.get(key);
    ref.rows += 1;
  }

  console.log("=== APPLIED FAMILY SUMMARY (latest import log) ===");
  console.log(JSON.stringify([...familySummary.values()].slice(0, 20), null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
