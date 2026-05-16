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

  // 2. إنشاء سياسة خدمات الأسنان الافتراضية (سقف 600، نسبة تحمل 0)
  const dentalPolicy = await prisma.servicePolicy.upsert({
    where: {
      company_id_service_type: {
        company_id: wahaBank.id,
        service_type: "DENTAL",
      },
    },
    update: {},
    create: {
      company_id: wahaBank.id,
      service_type: "DENTAL",
      annual_ceiling: 600,
      copay_percentage: 0,
      allow_partial_coverage: true,
      is_active: true,
    },
  });
  console.log(`✅ تم ضبط سياسة الأسنان: ${dentalPolicy.annual_ceiling} د.ل`);

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
