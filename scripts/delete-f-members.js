const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  // جلب المستفيدين الذين أرقام بطاقاتهم تحتوي F (أُنشئوا تلقائياً)
  const fMembers = await p.beneficiary.findMany({
    where: {
      card_number: { contains: "F" },
      deleted_at: null,
    },
    select: { id: true, card_number: true },
  });

  console.log(`عدد سجلات F: ${fMembers.length}`);

  if (fMembers.length === 0) {
    console.log("لا توجد سجلات للحذف.");
    return;
  }

  const ids = fMembers.map((m) => m.id);

  // حذف الحركات المرتبطة
  const deletedTx = await p.transaction.deleteMany({
    where: { beneficiary_id: { in: ids } },
  });
  console.log(`حُذفت ${deletedTx.count} حركة مرتبطة.`);

  // حذف الإشعارات المرتبطة
  const deletedNotif = await p.notification.deleteMany({
    where: { beneficiary_id: { in: ids } },
  });
  console.log(`حُذف ${deletedNotif.count} إشعار مرتبط.`);

  // حذف المستفيدين (hard delete)
  const deletedBen = await p.beneficiary.deleteMany({
    where: { id: { in: ids } },
  });
  console.log(`حُذف ${deletedBen.count} مستفيد.`);
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
