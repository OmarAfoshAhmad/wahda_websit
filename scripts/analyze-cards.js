const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // 1. كل البطاقات المرتبطة بالعائلتين الناقصتين
  for (const base of ["WAB202511986", "WAB202511987"]) {
    const all = await p.beneficiary.findMany({
      where: { card_number: { startsWith: base } },
      select: { card_number: true, name: true, status: true, deleted_at: true, total_balance: true },
      orderBy: { card_number: "asc" },
    });
    console.log(`=== ${base} (${all.length} سجلات including deleted) ===`);
    for (const r of all) {
      console.log(`  ${r.card_number} | ${r.name} | status: ${r.status} | deleted: ${r.deleted_at ? "YES" : "no"} | total: ${r.total_balance}`);
    }
  }

  // 2. هل كود الاستيراد يعرف الأفراد D1, S1, W1 etc؟
  // لنتحقق من النمط: كم عدد البطاقات مع لاحقة vs بدون
  const withSuffix = await p.$queryRaw`
    SELECT count(*)::int as c 
    FROM "Beneficiary" 
    WHERE deleted_at IS NULL 
    AND card_number ~ '[A-Z]\\d+$'
    AND card_number NOT LIKE 'WAB2025%'`;
  
  const baseSuffix = await p.$queryRaw`
    SELECT 
      CASE 
        WHEN card_number ~ '(D|S|W|M)\\d+$' THEN 'has_suffix'
        ELSE 'base_only'
      END as card_type,
      count(*)::int as c
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY card_type`;
  console.log("\n=== توزيع البطاقات (مع/بدون لاحقة) ===");
  for (const r of baseSuffix) {
    console.log(`  ${r.card_type}: ${r.c}`);
  }

  // 3. عينة من العائلات الكاملة (6+ أفراد)
  console.log("\n=== عائلة كاملة كنموذج: WAB202503798 ===");
  const sample = await p.beneficiary.findMany({
    where: { card_number: { startsWith: "WAB202503798" }, deleted_at: null },
    select: { card_number: true, name: true },
    orderBy: { card_number: "asc" },
  });
  for (const r of sample) {
    console.log(`  ${r.card_number} | ${r.name}`);
  }

  await p.$disconnect();
}

main().catch(console.error);
