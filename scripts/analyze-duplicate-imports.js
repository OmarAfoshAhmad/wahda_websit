// سكربت تحليل الحركات المكررة من الاستيراد
// يبحث عن أي مستفيد لديه أكثر من حركة IMPORT واحدة (غير ملغاة)
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function analyze() {
  console.log("=== تحليل الحركات المكررة من الاستيراد ===\n");

  // 1) جلب كل حركات IMPORT غير الملغاة مع بيانات المستفيد والمرفق
  const importTxs = await prisma.transaction.findMany({
    where: {
      type: "IMPORT",
      is_cancelled: false,
    },
    select: {
      id: true,
      beneficiary_id: true,
      facility_id: true,
      amount: true,
      created_at: true,
      beneficiary: {
        select: { name: true, card_number: true, total_balance: true, remaining_balance: true, status: true },
      },
      facility: { select: { name: true } },
    },
    orderBy: [{ beneficiary_id: "asc" }, { created_at: "asc" }],
  });

  console.log(`إجمالي حركات IMPORT الفعالة: ${importTxs.length}\n`);

  // 2) تجميع حسب المستفيد
  const byBeneficiary = new Map();
  for (const tx of importTxs) {
    const list = byBeneficiary.get(tx.beneficiary_id) ?? [];
    list.push(tx);
    byBeneficiary.set(tx.beneficiary_id, list);
  }

  // 3) إيجاد المكررات (أكثر من 1 IMPORT)
  const duplicates = [];
  for (const [beneficiaryId, txs] of byBeneficiary) {
    if (txs.length > 1) {
      const totalImported = txs.reduce((sum, tx) => sum + Number(tx.amount), 0);
      duplicates.push({
        beneficiaryId,
        name: txs[0].beneficiary.name,
        card_number: txs[0].beneficiary.card_number,
        total_balance: Number(txs[0].beneficiary.total_balance),
        remaining_balance: Number(txs[0].beneficiary.remaining_balance),
        status: txs[0].beneficiary.status,
        importCount: txs.length,
        totalImported: Math.round(totalImported * 100) / 100,
        transactions: txs.map((tx) => ({
          id: tx.id,
          amount: Number(tx.amount),
          facility: tx.facility.name,
          facility_id: tx.facility_id,
          date: tx.created_at.toISOString(),
        })),
      });
    }
  }

  console.log(`عدد المستفيدين بحركات IMPORT مكررة: ${duplicates.length}\n`);

  // 4) إحصائيات
  if (duplicates.length > 0) {
    console.log("--- تفاصيل المستفيدين المتأثرين ---\n");
    for (const d of duplicates) {
      console.log(`📌 ${d.name} (${d.card_number})`);
      console.log(`   الحالة: ${d.status} | الرصيد الأصلي: ${d.total_balance} | المتبقي: ${d.remaining_balance}`);
      console.log(`   عدد حركات الاستيراد: ${d.importCount} | إجمالي المخصوم: ${d.totalImported}`);
      for (const tx of d.transactions) {
        console.log(`   - حركة ${tx.id.slice(0,8)}... مبلغ: ${tx.amount} | المرفق: ${tx.facility} (${tx.facility_id.slice(0,8)}...) | التاريخ: ${tx.date.slice(0,10)}`);
      }
      console.log("");
    }

    // 5) تحليل: هل تتطابق المبالغ (يعني نفس الحركة مكررة)؟
    let exactDuplicates = 0;
    let differentAmounts = 0;
    let sameFacilityDupes = 0;
    let diffFacilityDupes = 0;

    for (const d of duplicates) {
      const amounts = d.transactions.map(t => t.amount);
      const allSame = amounts.every(a => a === amounts[0]);
      if (allSame) exactDuplicates++;
      else differentAmounts++;

      const facilities = new Set(d.transactions.map(t => t.facility_id));
      if (facilities.size === 1) sameFacilityDupes++;
      else diffFacilityDupes++;
    }

    console.log("=== ملخص ===");
    console.log(`حالات بنفس المبلغ (نسخة مكررة بالضبط): ${exactDuplicates}`);
    console.log(`حالات بمبالغ مختلفة: ${differentAmounts}`);
    console.log(`حالات من نفس المرفق: ${sameFacilityDupes}`);
    console.log(`حالات من مرافق مختلفة: ${diffFacilityDupes}`);

    // 6) الفرق الإجمالي
    let totalOverDeducted = 0;
    for (const d of duplicates) {
      // الحركة الصحيحة هي واحدة فقط (الأولى أو الأكبر)
      // الزيادة = المجموع - الحركة الواحدة الصحيحة
      const correctAmount = d.transactions[0].amount;
      const excess = d.totalImported - correctAmount;
      totalOverDeducted += excess;
    }
    console.log(`\nإجمالي المبالغ المخصومة زيادةً: ${Math.round(totalOverDeducted * 100) / 100} دينار`);
  }

  // 7) فحص audit logs للاستيراد
  const importLogs = await prisma.auditLog.findMany({
    where: { action: "IMPORT_TRANSACTIONS" },
    select: { id: true, user: true, created_at: true, facility_id: true },
    orderBy: { created_at: "desc" },
  });

  console.log(`\n=== سجلات عمليات الاستيراد ===`);
  console.log(`عدد عمليات الاستيراد المسجلة: ${importLogs.length}`);
  for (const log of importLogs) {
    console.log(`  - ${log.created_at.toISOString().slice(0,19)} | المستخدم: ${log.user} | المرفق: ${log.facility_id.slice(0,8)}...`);
  }

  // خروج بـ JSON للاستخدام في السكربت التالي
  console.log("\n\n=== JSON_DATA_START ===");
  console.log(JSON.stringify(duplicates, null, 0));
  console.log("=== JSON_DATA_END ===");

  await prisma.$disconnect();
}

analyze().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
