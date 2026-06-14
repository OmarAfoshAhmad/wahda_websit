/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const companies = [
  { name: "الشركة الليبية للإسمنت (Cement)", code: "LCC", pattern: "^LCC2025.*", ceiling: 2000.00, coverage: 80 },
  { name: "أوزون (OZONE)", code: "O3G", pattern: "^O3G2025.*", ceiling: 2000.00, coverage: 80 },
  { name: "توسالي (Tosyali)", code: "TOSY", pattern: "^TOSY2025.*", ceiling: 3000.00, coverage: 80 },
  { name: "فيجن (Vision)", code: "VISN", pattern: "^VISN2025.*", ceiling: 3000.00, coverage: 100 },
  { name: "فيوتشر (Future)", code: "FUTU", pattern: "^FUTU2025.*", ceiling: 3000.00, coverage: 100 },
  { name: "رواق (Rewaq)", code: "RWG", pattern: "^RWG2025.*", ceiling: 3000.00, coverage: 100 },
  { name: "أركاديا (Arcadia)", code: "ARCD", pattern: "^ARCAD2025.*", ceiling: 3000.00, coverage: 100 },
  { name: "حجر الماس (Hajar)", code: "HJR", pattern: "^HJR2026.*", ceiling: 3000.00, coverage: 100 },
  { name: "وعد (Waad)", code: "WAAD", pattern: "^WAAD2025.*", ceiling: 3000.00, coverage: 100 },
  { name: "الوعد المعماري (Waad Architect)", code: "WCA", pattern: "^WCA2026.*", ceiling: 3000.00, coverage: 100 },
  { name: "الواحة (Waha)", code: "WAHA", pattern: "^WAHA2025.*", ceiling: 3000.00, coverage: 100 },
  { name: "الجمارك (Jamarek)", code: "JMR", pattern: "^JMR2025.*", ceiling: 3000.00, coverage: 75 },
  { name: "المنطقة الحرة (JFZ)", code: "JFZ", pattern: "^JFZ2025.*", ceiling: null, coverage: 75 },
  { name: "جوليانة (Julian)", code: "JULI", pattern: "^JULI2025.*", ceiling: 3000.00, coverage: 100 },
];

async function main() {
  console.log("🚀 بدء عملية إدخال وتحديث شركات التأمين والسياسات...");

  // جلب معرفات الخدمات (يجب أن تكون موجودة مسبقاً)
  const dentalService = await prisma.serviceType.findUnique({ where: { code: "DENTAL" } });
  const opticsService = await prisma.serviceType.findUnique({ where: { code: "OPTICS" } });

  if (!dentalService || !opticsService) {
    console.error("❌ الخدمات الأساسية (DENTAL, OPTICS) غير موجودة! يرجى تشغيل السكربت الذي يضيفها أولاً.");
    process.exit(1);
  }

  for (const comp of companies) {
    // 1. إنشاء أو تحديث الشركة
    const company = await prisma.insuranceCompany.upsert({
      where: { code: comp.code },
      update: {
        name: comp.name,
        card_pattern: comp.pattern,
        is_active: true,
        deleted_at: null,
      },
      create: {
        name: comp.name,
        code: comp.code,
        card_pattern: comp.pattern,
        is_active: true,
      }
    });

    // 2. تحديث سياسة الأسنان
    await prisma.servicePolicy.upsert({
      where: { 
        company_id_service_type_id: { company_id: company.id, service_type_id: dentalService.id }
      },
      update: {
        ceiling_amount: comp.ceiling,
        coverage_percent: comp.coverage,
      },
      create: {
        company_id: company.id,
        service_type_id: dentalService.id,
        ceiling_amount: comp.ceiling,
        coverage_percent: comp.coverage,
      }
    });

    // 3. تحديث سياسة البصريات (بافتراض نفس السقف للآن)
    await prisma.servicePolicy.upsert({
      where: { 
        company_id_service_type_id: { company_id: company.id, service_type_id: opticsService.id }
      },
      update: {
        ceiling_amount: comp.ceiling,
        coverage_percent: comp.coverage,
      },
      create: {
        company_id: company.id,
        service_type_id: opticsService.id,
        ceiling_amount: comp.ceiling,
        coverage_percent: comp.coverage,
      }
    });

    console.log(`✅ الشركة: ${company.name} (${company.code}) | السياسات أُضيفت بنجاح`);
  }

  console.log("🏁 تمت العملية بنجاح!");
}

main()
  .catch(err => {
    console.error("❌ حدث خطأ أثناء عملية إدخال البيانات:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
