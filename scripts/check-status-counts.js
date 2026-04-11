const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // 1. توزيع الحالات
  const counts = await p.beneficiary.groupBy({
    by: ["status"],
    where: { deleted_at: null },
    _count: true,
  });
  console.log("=== توزيع الحالات ===");
  for (const c of counts) {
    console.log(`  ${c.status}: ${c._count}`);
  }

  // 2. الموقوفين
  const suspended = await p.beneficiary.findMany({
    where: { status: "SUSPENDED", deleted_at: null },
    select: { id: true, name: true, remaining_balance: true, total_balance: true, created_at: true, completed_via: true },
    orderBy: { created_at: "desc" },
    take: 20,
  });
  console.log("\n=== آخر 20 موقوف (حسب updated_at) ===");
  for (const s of suspended) {
    console.log(`  ${s.name} | رصيد متبقي: ${s.remaining_balance} | إجمالي: ${s.total_balance} | تاريخ الإنشاء: ${s.created_at?.toISOString()} | completed_via: ${s.completed_via}`);
  }

  // 3. هل هناك موقوفون برصيد 0؟
  const suspendedZero = await p.beneficiary.count({
    where: { status: "SUSPENDED", deleted_at: null, remaining_balance: 0 },
  });
  const suspendedWithBalance = await p.beneficiary.count({
    where: { status: "SUSPENDED", deleted_at: null, remaining_balance: { gt: 0 } },
  });
  console.log(`\n=== موقوفون برصيد 0: ${suspendedZero} ===`);
  console.log(`=== موقوفون برصيد > 0: ${suspendedWithBalance} ===`);

  // 4. آخر عمليات rollback في سجل المراقبة
  const rollbacks = await p.auditLog.findMany({
    where: { action: "ROLLBACK_IMPORT" },
    orderBy: { created_at: "desc" },
    take: 10,
    select: { id: true, user: true, metadata: true, created_at: true },
  });
  console.log(`\n=== عمليات التراجع (${rollbacks.length}) ===`);
  for (const r of rollbacks) {
    console.log(`  ${r.created_at?.toISOString()} | ${r.user} | ${JSON.stringify(r.metadata)}`);
  }

  // 5. آخر عمليات استيراد
  const imports = await p.auditLog.findMany({
    where: { action: "IMPORT_BENEFICIARIES_BACKGROUND" },
    orderBy: { created_at: "desc" },
    take: 10,
    select: { id: true, user: true, metadata: true, created_at: true },
  });
  console.log(`\n=== آخر عمليات استيراد (${imports.length}) ===`);
  for (const r of imports) {
    const m = r.metadata;
    console.log(`  ${r.created_at?.toISOString()} | ${r.user} | inserted: ${m?.insertedRows} | dupe: ${m?.duplicateRows} | total: ${m?.totalRows} | jobId: ${m?.jobId}`);
  }

  // 6. حالات ImportJob
  const jobs = await p.importJob.findMany({
    orderBy: { created_at: "desc" },
    take: 10,
    select: { id: true, status: true, created_by: true, inserted_rows: true, total_rows: true, error_message: true, created_at: true, completed_at: true },
  });
  console.log(`\n=== آخر 10 مهام استيراد ===`);
  for (const j of jobs) {
    console.log(`  ${j.created_at?.toISOString()} | ${j.status} | by: ${j.created_by} | inserted: ${j.inserted_rows}/${j.total_rows} | ${j.error_message ?? ""}`);
  }

  await p.$disconnect();
}

main().catch(console.error);
