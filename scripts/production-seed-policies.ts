import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const opticsPolicyMap = [
  { keywords: ["سمنت", "LCC"], copay: 20, freqMonths: 12 },
  { keywords: ["جليانة", "JFZ"], copay: 25, freqMonths: 12 },
  { keywords: ["الجمارك", "JMR"], copay: 25, freqMonths: 12 },
  { keywords: ["القابضة", "فيوتشر", "الواحة", "فيجن", "وعد"], copay: 0, freqMonths: 12 },
  { keywords: ["توسيالي", "TOSY"], copay: 20, freqMonths: 12 },
  { keywords: ["وزون", "O3G", "OZONE"], copay: 0, freqMonths: 12 },
  { keywords: ["الوحدة", "WAHDA"], copay: 0, freqMonths: 24 },
  { keywords: ["اركاديا", "Arcadia", "ARCD"], copay: 0, freqMonths: 12 },
  { keywords: ["الرواق", "rewaq"], copay: 0, freqMonths: 12 },
  { keywords: ["حجر الماس", "HJR"], copay: 0, freqMonths: 12 },
];

async function main() {
  console.log("🚀 Starting Production DB Migration & Seeding for Service Engine...");

  // 1. Ensure Service Types exist
  const dentalType = await prisma.serviceType.upsert({
    where: { code: "DENTAL" },
    update: {},
    create: { code: "DENTAL", name: "الأسنان", is_active: true },
  });

  const opticsType = await prisma.serviceType.upsert({
    where: { code: "OPTICS" },
    update: {},
    create: { code: "OPTICS", name: "البصريات", is_active: true },
  });

  // 2. Fetch all companies (to migrate legacy dental data)
  const allCompanies = await prisma.insuranceCompany.findMany({
    select: {
      id: true,
      name: true,
      dental_ceiling: true, // Legacy columns
      dental_coverage: true,
      is_active: true,
    },
  });

  console.log(`📦 Found ${allCompanies.length} companies to process...`);

  for (const company of allCompanies) {
    // ---- A. MIGRATE DENTAL POLICIES ----
    if (company.is_active && !company.name.includes("الوحدة")) {
      const dentalCoverage = company.dental_coverage ? Number(company.dental_coverage) : 100;
      const dentalCeiling = company.dental_ceiling ? Number(company.dental_ceiling) : null;
      
      await prisma.servicePolicy.upsert({
        where: { company_id_service_type_id: { company_id: company.id, service_type_id: dentalType.id } },
        update: {
          ceiling_amount: dentalCeiling,
          coverage_percent: dentalCoverage,
          frequency_months: 12,
        },
        create: {
          company_id: company.id,
          service_type_id: dentalType.id,
          ceiling_amount: dentalCeiling,
          coverage_percent: dentalCoverage,
          frequency_months: 12,
          is_active: true,
        },
      });
    }

    // ---- B. SEED OPTICS POLICIES ----
    if (company.is_active) {
      let copay = 0;
      let frequency = 12;

      const matchedConfig = opticsPolicyMap.find((config) =>
        config.keywords.some((kw) => company.name.toLowerCase().includes(kw.toLowerCase()))
      );

      if (matchedConfig) {
        copay = matchedConfig.copay;
        frequency = matchedConfig.freqMonths;
      }

      await prisma.servicePolicy.upsert({
        where: { company_id_service_type_id: { company_id: company.id, service_type_id: opticsType.id } },
        update: {
          coverage_percent: 100 - copay,
          frequency_months: frequency,
          ceiling_amount: 500,
          is_active: true,
        },
        create: {
          company_id: company.id,
          service_type_id: opticsType.id,
          ceiling_amount: 500,
          coverage_percent: 100 - copay,
          frequency_months: frequency,
          is_active: true,
        },
      });
    }
  }

  // 3. Special Rule for Wahda Bank
  const wahda = await prisma.insuranceCompany.findFirst({
    where: { name: { contains: "الوحدة" } }
  });

  if (wahda) {
    await prisma.insuranceCompany.update({
      where: { id: wahda.id },
      data: { is_active: true }
    });

    const dentalPol = await prisma.servicePolicy.findUnique({
      where: { company_id_service_type_id: { company_id: wahda.id, service_type_id: dentalType.id } }
    });
    if (dentalPol) {
      await prisma.servicePolicy.update({
        where: { id: dentalPol.id },
        data: { is_active: false } // Wahda is Optics Only
      });
    }
    console.log(`✅ Special Rules applied for: ${wahda.name}`);
  }

  console.log("🎉 Production Migration & Seeding completed successfully!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
