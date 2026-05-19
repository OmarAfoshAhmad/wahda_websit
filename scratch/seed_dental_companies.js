const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const dentalCompanies = [
  { name: "أوزون (OZONE)", code: "O3G", pattern: "^O3G2025.*" },
  { name: "توسالي (Tosyali)", code: "TOSY", pattern: "^TOSY2025.*" },
  { name: "فيجن (Vision)", code: "VISN", pattern: "^VISN2025.*" },
  { name: "فيوتشر (Future)", code: "FUTU", pattern: "^FUTU2025.*" },
  { name: "رواق (Rewaq)", code: "RWG", pattern: "^RWG2025.*" }
];

async function main() {
  console.log("Seeding Dental Companies and Policies...");
  for (const comp of dentalCompanies) {
    // 1. Create or Update InsuranceCompany
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
    console.log(`✓ Company: ${company.name} (${company.code}) ID: ${company.id}`);

    // 2. Create or Update ServicePolicy (DENTAL)
    const policy = await prisma.servicePolicy.upsert({
      where: {
        company_id_service_type: {
          company_id: company.id,
          service_type: "DENTAL"
        }
      },
      update: {
        annual_ceiling: 3000.00,
        copay_percentage: 0.00,
        allow_partial_coverage: true,
        is_active: true
      },
      create: {
        company_id: company.id,
        service_type: "DENTAL",
        annual_ceiling: 3000.00,
        copay_percentage: 0.00,
        allow_partial_coverage: true,
        is_active: true
      }
    });
    console.log(`  ✓ ServicePolicy: DENTAL, Ceiling: 3000, Copay: 0% ID: ${policy.id}`);
  }
  console.log("Seeding completed successfully!");
}

main()
  .catch(err => {
    console.error("Error during seeding:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
