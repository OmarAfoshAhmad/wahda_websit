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

  for (const comp of companies) {
    // 1. إنشاء أو تحديث الشركة بالسياسات المدمجة
    const company = await prisma.insuranceCompany.upsert({
      where: { code: comp.code },
      update: {
        name: comp.name,
        card_pattern: comp.pattern,
        is_active: true,
        deleted_at: null,
        dental_ceiling: comp.ceiling,
        dental_coverage: comp.coverage,
        general_ceiling: null,
        general_coverage: 0,
        medicine_ceiling: null,
        medicine_coverage: 0
      },
      create: {
        name: comp.name,
        code: comp.code,
        card_pattern: comp.pattern,
        is_active: true,
        dental_ceiling: comp.ceiling,
        dental_coverage: comp.coverage,
        general_ceiling: null,
        general_coverage: 0,
        medicine_ceiling: null,
        medicine_coverage: 0
      }
    });
    console.log(`✅ الشركة: ${company.name} (${company.code}) | ID: ${company.id}`);
    console.log(`   └─ الأسنان: سقف = ${company.dental_ceiling} د.ل | تحمل = ${100 - Number(company.dental_coverage)}%`);
    console.log(`   └─ العام: سقف = مغلق | تحمل = 100%`);
    console.log(`   └─ الأدوية: سقف = مغلق | تحمل = 100%`);
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
