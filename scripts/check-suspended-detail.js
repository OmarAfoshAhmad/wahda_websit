const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // 1. توزيع الموقوفين حسب تاريخ الإنشاء
  const byDate = await p.$queryRaw`
    SELECT DATE(created_at) as d, count(*)::int as c 
    FROM "Beneficiary" 
    WHERE status='SUSPENDED' AND deleted_at IS NULL 
    GROUP BY DATE(created_at) 
    ORDER BY d DESC LIMIT 15`;
  console.log("=== الموقوفون حسب تاريخ الإنشاء ===");
  for (const x of byDate) console.log(`  ${x.d.toISOString().slice(0, 10)}: ${x.c}`);

  // 2. هل كانوا موقوفين قبل اليوم؟
  const beforeToday = await p.beneficiary.count({
    where: { status: "SUSPENDED", deleted_at: null, created_at: { lt: new Date("2026-04-11") } },
  });
  console.log(`\nموقوفون قبل اليوم: ${beforeToday}`);
  const today = await p.beneficiary.count({
    where: { status: "SUSPENDED", deleted_at: null, created_at: { gte: new Date("2026-04-11") } },
  });
  console.log(`موقوفون اليوم: ${today}`);

  // 3. فحص المستفيدين المستوردين اليوم
  const importedToday = await p.$queryRaw`
    SELECT status, count(*)::int as c 
    FROM "Beneficiary" 
    WHERE created_at >= '2026-04-11' AND deleted_at IS NULL 
    GROUP BY status`;
  console.log("\n=== حالات المستفيدين المُنشئين اليوم ===");
  for (const x of importedToday) console.log(`  ${x.status}: ${x.c}`);

  // 4. هل هناك موقوفون ليس لديهم حركات؟
  const suspendedNoTx = await p.$queryRaw`
    SELECT count(*)::int as c
    FROM "Beneficiary" b
    WHERE b.status = 'SUSPENDED' AND b.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE t.beneficiary_id = b.id)`;
  console.log(`\nموقوفون بدون أي حركات: ${suspendedNoTx[0].c}`);

  const suspendedWithTx = await p.$queryRaw`
    SELECT count(*)::int as c
    FROM "Beneficiary" b
    WHERE b.status = 'SUSPENDED' AND b.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM "Transaction" t WHERE t.beneficiary_id = b.id)`;
  console.log(`موقوفون مع حركات: ${suspendedWithTx[0].c}`);

  await p.$disconnect();
}

main().catch(console.error);
