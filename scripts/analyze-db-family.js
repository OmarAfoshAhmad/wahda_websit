const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // 1. البحث عن أفراد العائلة WAB202511986
  const family = await p.beneficiary.findMany({
    where: { card_number: { startsWith: "WAB202511986" }, deleted_at: null },
    select: { id: true, card_number: true, name: true, total_balance: true, remaining_balance: true, status: true, created_at: true },
    orderBy: { card_number: "asc" },
  });
  console.log(`=== عائلة WAB202511986 (${family.length} أفراد) ===`);
  for (const f of family) {
    console.log(`  ${f.card_number} | ${f.name} | total: ${f.total_balance} | remaining: ${f.remaining_balance} | status: ${f.status} | created: ${f.created_at.toISOString().slice(0, 10)}`);
  }

  // 2. هل هناك أفراد محذوفين؟
  const deletedFamily = await p.beneficiary.findMany({
    where: { card_number: { startsWith: "WAB202511986" }, deleted_at: { not: null } },
    select: { id: true, card_number: true, name: true, total_balance: true, remaining_balance: true, status: true, deleted_at: true },
    orderBy: { card_number: "asc" },
  });
  if (deletedFamily.length > 0) {
    console.log(`\n=== أفراد محذوفون (${deletedFamily.length}) ===`);
    for (const f of deletedFamily) {
      console.log(`  ${f.card_number} | ${f.name} | total: ${f.total_balance} | remaining: ${f.remaining_balance} | deleted: ${f.deleted_at?.toISOString().slice(0, 10)}`);
    }
  }

  // 3. الحركات المرتبطة
  const memberIds = family.map((f) => f.id);
  if (memberIds.length > 0) {
    const txs = await p.transaction.findMany({
      where: { beneficiary_id: { in: memberIds } },
      select: { id: true, beneficiary_id: true, amount: true, type: true, is_cancelled: true, created_at: true },
      orderBy: { created_at: "desc" },
    });
    console.log(`\n=== الحركات (${txs.length}) ===`);
    for (const t of txs) {
      const member = family.find((f) => f.id === t.beneficiary_id);
      console.log(`  ${member?.card_number} | amount: ${t.amount} | type: ${t.type} | cancelled: ${t.is_cancelled} | date: ${t.created_at.toISOString().slice(0, 19)}`);
    }
  }

  // 4. عينة أخرى: WAB202503798 (عدد أفراد 6، رصيد 3600)
  console.log("\n\n=== عائلة WAB202503798 (المتوقع: 6 أفراد، 3600) ===");
  const family2 = await p.beneficiary.findMany({
    where: { card_number: { startsWith: "WAB202503798" }, deleted_at: null },
    select: { id: true, card_number: true, name: true, total_balance: true, remaining_balance: true, status: true },
    orderBy: { card_number: "asc" },
  });
  console.log(`  أفراد موجودون: ${family2.length}`);
  for (const f of family2) {
    console.log(`  ${f.card_number} | ${f.name} | total: ${f.total_balance} | remaining: ${f.remaining_balance} | status: ${f.status}`);
  }

  // 5. إحصائية عامة: كم عائلة فيها فرد واحد فقط؟
  const singleMemberCards = await p.$queryRaw`
    SELECT card_number, name, total_balance, remaining_balance, status
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND card_number LIKE 'WAB2025%'
      AND length(card_number) > 7
      AND NOT EXISTS (
        SELECT 1 FROM "Beneficiary" b2
        WHERE b2.deleted_at IS NULL
          AND b2.card_number LIKE CONCAT("Beneficiary".card_number, '-%')
      )
    LIMIT 5`;
  console.log("\n=== عينة بطاقات بدون أفراد ===");
  for (const s of singleMemberCards) {
    console.log(`  ${s.card_number} | ${s.name} | total: ${s.total_balance} | status: ${s.status}`);
  }

  // 6. الرصيد المبدئي: ما هو النمط؟
  const defaultBalances = await p.$queryRaw`
    SELECT total_balance, count(*)::int as c 
    FROM "Beneficiary" 
    WHERE deleted_at IS NULL AND status = 'ACTIVE'
    GROUP BY total_balance 
    ORDER BY c DESC 
    LIMIT 10`;
  console.log("\n=== توزيع الرصيد الكلي للنشطين ===");
  for (const d of defaultBalances) {
    console.log(`  ${d.total_balance}: ${d.c} مستفيد`);
  }

  await p.$disconnect();
}

main().catch(console.error);
