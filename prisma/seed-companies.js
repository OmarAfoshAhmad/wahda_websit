/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const companies = [
  { name: "أوزون (OZONE)", code: "O3G", pattern: "^O3G2025.*", ceiling: 3000.00 },
  { name: "توسالي (Tosyali)", code: "TOSY", pattern: "^TOSY2025.*", ceiling: 3000.00 },
  { name: "فيجن (Vision)", code: "VISN", pattern: "^VISN2025.*", ceiling: 3000.00 },
  { name: "فيوتشر (Future)", code: "FUTU", pattern: "^FUTU2025.*", ceiling: 3000.00 },
  { name: "رواق (Rewaq)", code: "RWG", pattern: "^RWG2025.*", ceiling: 3000.00 },
  { name: "أركاديا (Arcadia)", code: "ARCD", pattern: "^ARCAD2025.*", ceiling: 3000.00 },
  { name: "حجر الماس (Hajar)", code: "HJR", pattern: "^HJR2026.*", ceiling: 3000.00 },
  { name: "وعد (Waad)", code: "WAAD", pattern: "^WAAD2025.*", ceiling: 3000.00 },
  { name: "الوعد المعماري (Waad Architect)", code: "WCA", pattern: "^WCA2026.*", ceiling: 3000.00 },
  { name: "الواحة (Waha)", code: "WAHA", pattern: "^WAHA2025.*", ceiling: 3000.00 },
];

async function main() {
  console.log("🚀 بدء عملية إدخال وتحديث شركات التأمين والسياسات...");

  for (const comp of companies) {
    // 1. إنشاء أو تحديث الشركة
    const company = await prisma.insuranceCompany.upsert({
      where: { code: comp.code },
      update: {
        name: comp.name,
        card_pattern: comp.pattern,
        is_active: true,
        deleted_at: null
      },
      create: {
        name: comp.name,
        code: comp.code,
        card_pattern: comp.pattern,
        is_active: true
      }
    });
    console.log(`✅ الشركة: ${company.name} (${company.code}) | ID: ${company.id}`);

    // 2. إنشاء أو تحديث سياسة خدمة الأسنان (DENTAL) للشركة
    const policy = await prisma.servicePolicy.upsert({
      where: {
        company_id_service_type: {
          company_id: company.id,
          service_type: "DENTAL"
        }
      },
      update: {
        annual_ceiling: comp.ceiling,
        copay_percentage: 0.00,
        allow_partial_coverage: true,
        is_active: true
      },
      create: {
        company_id: company.id,
        service_type: "DENTAL",
        annual_ceiling: comp.ceiling,
        copay_percentage: 0.00,
        allow_partial_coverage: true,
        is_active: true
      }
    });
    console.log(`   └─ سياسة الأسنان (DENTAL): السقف السنوي = ${policy.annual_ceiling} د.ل | تحمل = 0%`);
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
