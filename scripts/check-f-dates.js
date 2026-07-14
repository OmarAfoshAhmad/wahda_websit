const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // توزيع سجلات F حسب التاريخ
  const all = await p.beneficiary.findMany({
    where: { card_number: { contains: "F" }, deleted_at: null },
    select: { created_at: true },
    orderBy: { created_at: "asc" },
  });

  const byDate = {};
  all.forEach((r) => {
    const d = r.created_at.toISOString().split("T")[0];
    byDate[d] = (byDate[d] || 0) + 1;
  });

  console.log("توزيع سجلات F حسب تاريخ الإنشاء:");
  Object.entries(byDate)
    .sort()
    .forEach(([date, count]) => console.log(`  ${date}: ${count}`));

  console.log("\nالإجمالي:", all.length);

  // تحقق: هل هناك سجلات F أُنشئت قبل اليوم؟
  const today = new Date("2026-04-11T00:00:00Z");
  const beforeToday = all.filter((r) => r.created_at < today).length;
  const todayCount = all.length - beforeToday;
  console.log(`\nقبل اليوم: ${beforeToday}`);
  console.log(`اليوم: ${todayCount}`);
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
