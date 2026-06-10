import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Data from table mapping company names to coverage & frequency
// Assuming "خصم" means patient copay.
// So Coverage % = 100 - Copay %.
// "بدون خصم" = 0% Copay -> 100% Coverage.
const policyMap = [
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
  console.log("Starting Precise Optics Policies Update...");

  const opticsType = await prisma.serviceType.findUnique({ where: { code: "OPTICS" } });
  const dentalType = await prisma.serviceType.findUnique({ where: { code: "DENTAL" } });

  if (!opticsType || !dentalType) {
    throw new Error("Missing service types");
  }

  // 1. Fetch all companies
  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    select: { id: true, name: true },
  });

  console.log(`Found ${companies.length} active companies.`);

  for (const company of companies) {
    // Determine policy based on name matching
    let copay = 0; // Default: بدون خصم
    let frequency = 12; // Default: نظارة كل سنة

    const matchedConfig = policyMap.find((config) =>
      config.keywords.some((kw) => company.name.toLowerCase().includes(kw.toLowerCase()))
    );

    if (matchedConfig) {
      copay = matchedConfig.copay;
      frequency = matchedConfig.freqMonths;
      console.log(`Matched [${company.name}] -> Copay: ${copay}%, Frequency: ${frequency} months`);
    } else {
      console.log(`Unmatched [${company.name}], using default -> Copay: 0%, Frequency: 12 months`);
    }

    const coverage = 100 - copay;

    // UPDATE OR CREATE OPTICS POLICY
    await prisma.servicePolicy.upsert({
      where: {
        company_id_service_type_id: {
          company_id: company.id,
          service_type_id: opticsType.id,
        },
      },
      update: {
        coverage_percent: coverage,
        frequency_months: frequency,
        ceiling_amount: 500, // as requested earlier
        is_active: true,
      },
      create: {
        company_id: company.id,
        service_type_id: opticsType.id,
        ceiling_amount: 500,
        coverage_percent: coverage,
        frequency_months: frequency,
        is_active: true,
      },
    });

    // Special rule for "الوحدة" -> Optics ONLY (disable Dental)
    if (company.name.includes("الوحدة")) {
      await prisma.servicePolicy.updateMany({
        where: {
          company_id: company.id,
          service_type_id: dentalType.id,
        },
        data: {
          is_active: false,
        },
      });
      console.log(`Disabled DENTAL policy for [${company.name}].`);
    }
  }

  console.log("Precise Policies Update Complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
