const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const card = (process.argv[2] || "WAB20259925").trim().toUpperCase();

  const ben = await prisma.beneficiary.findFirst({
    where: { card_number: { equals: card, mode: "insensitive" } },
    select: {
      id: true,
      card_number: true,
      name: true,
      status: true,
      total_balance: true,
      remaining_balance: true,
      completed_via: true,
    },
  });

  if (!ben) {
    console.log(JSON.stringify({ card, found: false }, null, 2));
    return;
  }

  const tx = await prisma.transaction.findMany({
    where: { beneficiary_id: ben.id },
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      type: true,
      amount: true,
      is_cancelled: true,
      created_at: true,
      original_transaction_id: true,
      facility_id: true,
    },
  });

  const facilityIds = [...new Set(tx.map((t) => t.facility_id).filter(Boolean))];
  const facilities = facilityIds.length
    ? await prisma.facility.findMany({ where: { id: { in: facilityIds } }, select: { id: true, name: true } })
    : [];
  const facMap = new Map(facilities.map((f) => [f.id, f.name]));

  const activeImports = tx.filter((t) => t.type === "IMPORT" && !t.is_cancelled);

  const archive = await prisma.$queryRaw`
    SELECT family_base_card, family_count_from_file, total_balance_from_file::float8 AS total_balance_from_file,
           used_balance_from_file::float8 AS used_balance_from_file, source_row_number, last_imported_at
    FROM "FamilyImportArchive"
    WHERE family_base_card = ${card}
    LIMIT 1
  `;

  const importLogs = await prisma.auditLog.findMany({
    where: { action: "IMPORT_TRANSACTIONS" },
    orderBy: { created_at: "desc" },
    take: 30,
    select: { id: true, created_at: true, metadata: true },
  });

  const logHits = [];
  for (const l of importLogs) {
    const md = l.metadata || {};
    const rows = Array.isArray(md.appliedRows) ? md.appliedRows : [];
    const hit = rows.filter((r) => String(r?.cardNumber || "").toUpperCase() === card);
    if (hit.length > 0) {
      logHits.push({
        id: l.id,
        created_at: l.created_at,
        hitCount: hit.length,
        hit,
      });
    }
  }

  const similar = await prisma.$queryRaw`
    SELECT b.card_number, b.name, COUNT(*)::int AS import_count, SUM(t.amount)::float8 AS import_sum
    FROM "Transaction" t
    JOIN "Beneficiary" b ON b.id = t.beneficiary_id
    WHERE t.type = 'IMPORT' AND t.is_cancelled = false
    GROUP BY b.id, b.card_number, b.name
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, b.card_number ASC
    LIMIT 50
  `;

  console.log(
    JSON.stringify(
      {
        beneficiary: {
          ...ben,
          total_balance: Number(ben.total_balance),
          remaining_balance: Number(ben.remaining_balance),
        },
        activeImportCount: activeImports.length,
        activeImports: activeImports.map((t) => ({
          ...t,
          amount: Number(t.amount),
          facility_name: facMap.get(t.facility_id) || null,
        })),
        allTransactions: tx.map((t) => ({
          ...t,
          amount: Number(t.amount),
          facility_name: facMap.get(t.facility_id) || null,
        })),
        archive,
        importLogHits: logHits,
        similarDuplicateImportCasesTop50: similar,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
