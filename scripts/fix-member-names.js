const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // ابحث عن المستفيدين الذين أسماؤهم تبدأ بـ "فرد "
  const records = await prisma.beneficiary.findMany({
    where: { name: { startsWith: "فرد " }, deleted_at: null },
    select: { id: true, name: true, card_number: true },
  });

  console.log("عدد السجلات:", records.length);
  if (records.length === 0) {
    console.log("لا توجد سجلات تحتاج تعديل.");
    return;
  }

  // نمط: "فرد N - الاسم الحقيقي"
  const pattern = /^فرد\s+\d+\s*-\s*/;
  const toUpdate = records.filter((r) => pattern.test(r.name));
  console.log("سجلات تحتاج تعديل:", toUpdate.length);

  toUpdate.slice(0, 5).forEach((r) => {
    const newName = r.name.replace(pattern, "");
    console.log(`  ${r.card_number}: "${r.name}" → "${newName}"`);
  });

  // تحديث الأسماء
  let updated = 0;
  for (const r of toUpdate) {
    const newName = r.name.replace(pattern, "");
    if (newName && newName !== r.name) {
      await prisma.beneficiary.update({
        where: { id: r.id },
        data: { name: newName },
      });
      updated++;
    }
  }

  console.log(`تم تحديث ${updated} سجل.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
