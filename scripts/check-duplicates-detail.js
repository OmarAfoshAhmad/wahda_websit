const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  // جلب تفاصيل كل مجموعة تكرار canonical
  const canonicalDups = await prisma.$queryRaw`
    SELECT 
      REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^(WAB2025)0+', E'\\1') AS canonical,
      ARRAY_AGG(id ORDER BY card_number) AS ids
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND UPPER(BTRIM(card_number)) LIKE 'WAB2025%'
    GROUP BY REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^(WAB2025)0+', E'\\1')
    HAVING COUNT(*) > 1
    ORDER BY canonical
  `;

  console.log("=== تفاصيل المجموعات المكررة ===\n");

  const allIds = canonicalDups.flatMap(g => g.ids);
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      name: true,
      card_number: true,
      status: true,
      total_balance: true,
      remaining_balance: true,
      completed_via: true,
      _count: { select: { transactions: true } },
    },
  });

  const byId = new Map(beneficiaries.map(b => [b.id, b]));

  for (const group of canonicalDups) {
    console.log(`--- ${group.canonical} ---`);
    for (const id of group.ids) {
      const b = byId.get(id);
      if (!b) { console.log("  [غير موجود]", id); continue; }
      console.log(
        `  ${b.card_number.padEnd(22)} | الاسم: ${b.name.padEnd(30)} | الحالة: ${b.status.padEnd(10)} | الرصيد: ${Number(b.total_balance)} → متبقي: ${Number(b.remaining_balance)} | حركات: ${b._count.transactions} | اكتمال: ${b.completed_via ?? "-"}`
      );
    }
    console.log();
  }

  // التحقق من سجلات التجاهل
  const ignoreLogs = await prisma.auditLog.findMany({
    where: { action: "IGNORE_DUPLICATE_PAIR" },
    select: { metadata: true, created_at: true },
  });
  console.log("=== سجلات التجاهل (IGNORE_DUPLICATE_PAIR) ===");
  console.log("عدد السجلات:", ignoreLogs.length);
  for (const log of ignoreLogs) {
    const meta = log.metadata || {};
    console.log("  IDs:", JSON.stringify(meta.ignore_ids), "| التاريخ:", log.created_at);
  }

  await prisma.$disconnect();
})();
