/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PHYSIOTHERAPY_LIMITS = [
  { code: "LCC", limit: 20 },
  { code: "O3G", limit: 10 },
  { code: "TOSY", limit: 10 },
  { code: "VISN", limit: 10 },
  { code: "FUTU", limit: 40 },
  { code: "RWG", limit: 11 },
  { code: "ARCD", limit: 40 },
  { code: "HJR", limit: 40 },
  { code: "WAAD", limit: 40 },
  { code: "WCA", limit: 40 },
  { code: "WAHA", limit: 40 },
  { code: "JMR", limit: 20 },
  { code: "JFZ", limit: 20 },
  { code: "WAB", limit: 70 },
];

async function main() {
  console.log("🚀 بدء عملية إدخال سياسات العلاج الطبيعي (الجلسات)...");

  // 1. إضافة أو جلب نوع الخدمة (PHYSIOTHERAPY)
  const physioService = await prisma.serviceType.upsert({
    where: { code: "PHYSIOTHERAPY" },
    update: {
      name: "العلاج الطبيعي (جلسات)",
      is_active: true,
    },
    create: {
      code: "PHYSIOTHERAPY",
      name: "العلاج الطبيعي (جلسات)",
      is_active: true,
    }
  });

  console.log(`✅ تم تأكيد وجود خدمة العلاج الطبيعي (ID: ${physioService.id})`);

  // 2. تحديث السياسات لكل شركة
  for (const item of PHYSIOTHERAPY_LIMITS) {
    const company = await prisma.insuranceCompany.findUnique({
      where: { code: item.code }
    });

    if (!company) {
      console.warn(`⚠️ الشركة ذات الرمز ${item.code} غير موجودة في قاعدة البيانات. تم تخطيها.`);
      continue;
    }

    // إضافة أو تحديث سياسة العلاج الطبيعي لهذه الشركة
    // نعتبر ceiling_amount هو عدد الجلسات، و coverage_percent = 100
    await prisma.servicePolicy.upsert({
      where: {
        company_id_service_type_id: { company_id: company.id, service_type_id: physioService.id }
      },
      update: {
        ceiling_amount: item.limit,
        coverage_percent: 100.00,
        frequency_months: 12 // سنوية لا تتجدد إلا بعد عام
      },
      create: {
        company_id: company.id,
        service_type_id: physioService.id,
        ceiling_amount: item.limit,
        coverage_percent: 100.00,
        frequency_months: 12
      }
    });

    console.log(`✅ الشركة: ${company.name} (${company.code}) | أُضيفت سياسة العلاج الطبيعي: ${item.limit} جلسة`);
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
