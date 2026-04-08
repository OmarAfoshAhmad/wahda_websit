const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  // 1. تكرارات رقم البطاقة بالضبط (exact duplicates)
  const exactDups = await prisma.$queryRaw`
    SELECT card_number, COUNT(*)::int AS cnt
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY card_number
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `;
  console.log("=== تكرارات رقم البطاقة بالضبط (غير محذوفين) ===");
  console.log("عدد المجموعات:", exactDups.length);
  if (exactDups.length > 0) console.table(exactDups);

  // 2. تكرارات canonical (بعد إزالة الأصفار)
  const canonicalDups = await prisma.$queryRaw`
    SELECT 
      REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^(WAB2025)0+', E'\\1') AS canonical,
      COUNT(*)::int AS cnt,
      ARRAY_AGG(card_number ORDER BY card_number) AS cards,
      ARRAY_AGG(id ORDER BY card_number) AS ids
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND UPPER(BTRIM(card_number)) LIKE 'WAB2025%'
    GROUP BY REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^(WAB2025)0+', E'\\1')
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `;
  console.log("\n=== تكرارات canonical (اختلاف الأصفار) ===");
  console.log("عدد المجموعات:", canonicalDups.length);
  if (canonicalDups.length > 0) {
    for (const g of canonicalDups) {
      console.log("  canonical:", g.canonical, "| عدد:", g.cnt, "| البطاقات:", g.cards.join(", "));
    }
  }

  // 3. تكرارات UPPER(BTRIM(card_number)) — نفس الرقم بعد تطبيع المسافات والأحرف
  const trimDups = await prisma.$queryRaw`
    SELECT 
      UPPER(BTRIM(card_number)) AS norm_card,
      COUNT(*)::int AS cnt,
      ARRAY_AGG(card_number ORDER BY card_number) AS raw_cards
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY UPPER(BTRIM(card_number))
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `;
  console.log("\n=== تكرارات بعد تطبيع الأحرف والمسافات ===");
  console.log("عدد المجموعات:", trimDups.length);
  if (trimDups.length > 0) {
    for (const g of trimDups) {
      console.log("  norm:", g.norm_card, "| عدد:", g.cnt, "| الخام:", g.raw_cards.join(", "));
    }
  }

  // 4. تكرارات نفس الاسم مع بطاقات مختلفة
  const nameDups = await prisma.$queryRaw`
    SELECT 
      LOWER(BTRIM(name)) AS norm_name,
      COUNT(*)::int AS cnt,
      ARRAY_AGG(card_number ORDER BY card_number) AS cards
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY LOWER(BTRIM(name))
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 15
  `;
  console.log("\n=== تكرارات نفس الاسم (بطاقات مختلفة) ===");
  console.log("عدد المجموعات:", nameDups.length);
  if (nameDups.length > 0) {
    for (const g of nameDups.slice(0, 15)) {
      console.log("  الاسم:", g.norm_name, "| عدد:", g.cnt, "| البطاقات:", g.cards.join(", "));
    }
  }

  // 5. إحصائية سريعة
  const total = await prisma.beneficiary.count({ where: { deleted_at: null } });
  const deleted = await prisma.beneficiary.count({ where: { deleted_at: { not: null } } });
  console.log("\n=== إحصائيات ===");
  console.log("إجمالي النشطين:", total);
  console.log("إجمالي المحذوفين (soft-deleted):", deleted);

  await prisma.$disconnect();
})();
