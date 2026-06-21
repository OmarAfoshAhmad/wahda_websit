import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateWahdaMukhassas() {
  console.log("🚀 بدء ترحيل سجلات المخصص العام لمصرف الوحدة...");

  // 1. جلب أو إنشاء شركة مصرف الوحدة
  const wahda = await prisma.insuranceCompany.upsert({
    where: { code: "WAB" },
    update: {},
    create: {
      name: "مصرف الوحدة",
      code: "WAB",
      card_pattern: "WAB-*",
      is_active: true,
    },
  });

  console.log(`✅ تم تأكيد شركة: ${wahda.name}`);

  // 2. ربط المستفيدين الذين بطاقاتهم تبدأ بـ WAB
  const benResult = await prisma.beneficiary.updateMany({
    where: {
      card_number: { startsWith: "WAB" },
      company_id: null,
    },
    data: {
      company_id: wahda.id,
    },
  });
  console.log(`✅ تم ربط ${benResult.count} مستفيد بمصرف الوحدة.`);

  // 3. ربط الحركات القديمة (المخصص العام) وتحويل نوعها إلى GENERAL
  // لكي تظهر في سجلات النظام الجديد بشكل صحيح ولا تختفي
  // نستخدم executeRaw لتجاوز فحص Prisma لأن DEDUCTION حذفت من الـ Schema
  const txResult = await prisma.$executeRawUnsafe(`
    UPDATE "Transaction"
    SET "type" = 'GENERAL', "company_id" = '${wahda.id}', "service_category" = 'GENERAL'
    WHERE "type"::text = 'DEDUCTION' AND "beneficiary_id" IN (
      SELECT "id" FROM "Beneficiary" WHERE "card_number" LIKE 'WAB%'
    )
  `);
  console.log(`✅ تم تحديث وربط ${txResult} حركة خصم سابقة للمخصص العام.`);

  console.log("🏁 تمت عملية معالجة المخصص بنجاح 100%.");
}

migrateWahdaMukhassas()
  .catch((e) => {
    console.error("❌ خطأ:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
