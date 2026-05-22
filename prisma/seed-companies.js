/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const companies = [
  { name: "الشركة الليبية للإسمنت (Cement)", code: "LCC", pattern: "^LCC2025.*", ceiling: 2000.00 },

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
  { name: "الجمارك (Jamarek)", code: "JMR", pattern: "^JMR2025.*", ceiling: 3000.00 },
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

    // 2. إنشاء أو تحديث سياسات الخدمات للشركة
    const services = [
      { type: "DENTAL", ceiling: comp.ceiling, copay: 0.00, partial: true },
      { type: "GENERAL", ceiling: null, copay: 20.00, partial: true },
      { type: "MEDICINE", ceiling: null, copay: 20.00, partial: true }
    ];

    for (const svc of services) {
      const policy = await prisma.servicePolicy.upsert({
        where: {
          company_id_service_type: {
            company_id: company.id,
            service_type: svc.type
          }
        },
        update: {
          annual_ceiling: svc.ceiling,
          copay_percentage: svc.copay,
          allow_partial_coverage: svc.partial,
          is_active: true
        },
        create: {
          company_id: company.id,
          service_type: svc.type,
          annual_ceiling: svc.ceiling,
          copay_percentage: svc.copay,
          allow_partial_coverage: svc.partial,
          is_active: true
        }
      });
      console.log(`   └─ سياسة (${svc.type}): السقف السنوي = ${policy.annual_ceiling !== null ? policy.annual_ceiling + " د.ل" : "مفتوح"} | تحمل = ${policy.copay_percentage}%`);
    }
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
