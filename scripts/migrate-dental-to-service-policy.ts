import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Migration: Dental Settings to Service Policies...");

  // 1. Ensure DENTAL ServiceType exists
  const dentalType = await prisma.serviceType.upsert({
    where: { code: "DENTAL" },
    update: {},
    create: {
      code: "DENTAL",
      name: "الأسنان",
      is_active: true,
    },
  });

  console.log(`DENTAL ServiceType ID: ${dentalType.id}`);

  // 2. Fetch all companies that are active (or all of them)
  const companies = await prisma.insuranceCompany.findMany({
    select: {
      id: true,
      name: true,
      dental_ceiling: true,
      dental_coverage: true,
    },
  });

  console.log(`Found ${companies.length} companies to migrate.`);

  let createdCount = 0;
  let updatedCount = 0;

  for (const company of companies) {
    const coverage = company.dental_coverage ? Number(company.dental_coverage) : 100;
    const ceiling = company.dental_ceiling ? Number(company.dental_ceiling) : null;

    // Check if policy already exists
    const existing = await prisma.servicePolicy.findUnique({
      where: {
        company_id_service_type_id: {
          company_id: company.id,
          service_type_id: dentalType.id,
        },
      },
    });

    if (existing) {
      await prisma.servicePolicy.update({
        where: { id: existing.id },
        data: {
          ceiling_amount: ceiling,
          coverage_percent: coverage,
          frequency_months: 12, // Default to 12 months for dental
        },
      });
      updatedCount++;
    } else {
      await prisma.servicePolicy.create({
        data: {
          company_id: company.id,
          service_type_id: dentalType.id,
          ceiling_amount: ceiling,
          coverage_percent: coverage,
          frequency_months: 12,
          is_active: true,
        },
      });
      createdCount++;
    }
  }

  console.log(`Migration Complete. Created: ${createdCount}, Updated: ${updatedCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
