const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const r = await p.auditLog.findMany({
    where: { action: "IMPORT_TRANSACTIONS" },
    orderBy: { created_at: "desc" },
    take: 10,
    select: { user: true, metadata: true, created_at: true },
  });
  console.log("=== عمليات استيراد الحركات ===");
  for (const x of r) {
    const m = x.metadata;
    console.log(
      `${x.created_at.toISOString().slice(0, 19)} | suspended: ${m.suspendedFamilies} | imported: ${m.importedFamilies} | notFound: ${m.notFoundRows} | updated: ${m.updatedFamilies ?? 0}`
    );
  }
  await p.$disconnect();
}

main().catch(console.error);
