import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * سكربت الهجرة الصامتة لـ "مصرف الوحدة"
 * =====================================
 * الهدف: تحويل النظام الحالي إلى المعمارية الجديدة دون التأثير على البيانات.
 */
async function migrate() {
  console.log("🚀 بدء عملية الهجرة الصامتة...");

  // 1. إنشاء شركة مصرف الوحدة
  const wahaBank = await prisma.insuranceCompany.upsert({
    where: { code: "WAB" },
    update: {},
    create: {
      name: "مصرف الوحدة",
      code: "WAB",
      card_pattern: "WAB-*",
      is_active: true,
    },
  });
  console.log(`✅ تم التأكد من وجود الشركة: ${wahaBank.name} (${wahaBank.id})`);

  // 2. ضبط سياسات الخدمات المدمجة في الشركة (سقف أسنان 600، تغطية 100%)
  await prisma.insuranceCompany.update({
    where: { id: wahaBank.id },
    data: {
      dental_ceiling: 600,
      dental_coverage: 100,
      general_ceiling: null,
      general_coverage: 80,
      medicine_ceiling: null,
      medicine_coverage: 80,
    },
  });
  console.log(`✅ تم ضبط سياسات الشركة: أسنان 600 د.ل (100%) | عام مفتوح (80%) | أدوية مفتوح (80%)`);

  // 3. ربط المستفيدين الحاليين (الذين يبدأ رقمهم بـ WAB) بالشركة
  const updateResult = await prisma.beneficiary.updateMany({
    where: {
      card_number: { startsWith: "WAB" },
      company_id: null, // فقط الذين لم يتم ربطهم بعد
    },
    data: {
      company_id: wahaBank.id,
    },
  });
  console.log(`✅ تم ربط ${updateResult.count} مستفيد بشركة مصرف الوحدة.`);

  console.log("🏁 تمت عملية الهجرة بنجاح.");
}

migrate()
  .catch((e) => {
    console.error("❌ فشلت عملية الهجرة:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
