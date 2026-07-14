/**
 * إصلاح المستفيدين بحالة FINISHED ورصيدهم المتبقي > 0
 * يعيدهم إلى حالة ACTIVE ويمسح completed_via
 *
 * الاستخدام:
 *   node scripts/fix-finished-with-balance.js          # عرض فقط (dry run)
 *   node scripts/fix-finished-with-balance.js --apply   # تنفيذ الإصلاح
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const dryRun = !process.argv.includes("--apply");

  // جلب المستفيدين بحالة FINISHED وغير محذوفين
  const finished = await prisma.beneficiary.findMany({
    where: { status: "FINISHED", deleted_at: null },
    select: { id: true, name: true, card_number: true, total_balance: true, completed_via: true },
  });

  if (finished.length === 0) {
    console.log("✅ لا يوجد مستفيدون بحالة FINISHED.");
    return;
  }

  // حساب المصروف لكل مستفيد
  const spentRows = await prisma.transaction.groupBy({
    by: ["beneficiary_id"],
    where: {
      beneficiary_id: { in: finished.map((b) => b.id) },
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    _sum: { amount: true },
  });

  const spentById = new Map(spentRows.map((row) => [row.beneficiary_id, Number(row._sum.amount ?? 0)]));

  const toFix = finished.filter((b) => {
    const total = Number(b.total_balance);
    const spent = spentById.get(b.id) ?? 0;
    const remaining = Math.round((total - spent) * 100) / 100;
    return remaining > 0;
  });

  if (toFix.length === 0) {
    console.log(`✅ جميع المستفيدين الـ ${finished.length} بحالة FINISHED رصيدهم = 0. لا يوجد تناقض.`);
    return;
  }

  console.log(`\n⚠️  وُجد ${toFix.length} مستفيد بحالة FINISHED ورصيد متبقي > 0:\n`);
  console.log("الاسم | رقم البطاقة | الرصيد الكلي | المصروف | المتبقي | completed_via");
  console.log("-".repeat(90));

  for (const b of toFix) {
    const total = Number(b.total_balance);
    const spent = spentById.get(b.id) ?? 0;
    const remaining = Math.round((total - spent) * 100) / 100;
    console.log(
      `${b.name} | ${b.card_number} | ${total} | ${spent} | ${remaining} | ${b.completed_via ?? "—"}`
    );
  }

  if (dryRun) {
    console.log(`\n📋 هذا عرض فقط (dry run). لتنفيذ الإصلاح أضف --apply`);
    return;
  }

  // تنفيذ الإصلاح
  const result = await prisma.beneficiary.updateMany({
    where: { id: { in: toFix.map((b) => b.id) } },
    data: { status: "ACTIVE", completed_via: null },
  });

  console.log(`\n✅ تم إصلاح ${result.count} مستفيد → حالتهم الآن ACTIVE`);
}

main()
  .catch((e) => {
    console.error("❌ خطأ:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
