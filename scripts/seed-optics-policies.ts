import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Optics Policies Seeding...");

  // 1. Ensure OPTICS ServiceType exists
  const opticsType = await prisma.serviceType.upsert({
    where: { code: "OPTICS" },
    update: {},
    create: {
      code: "OPTICS",
      name: "البصريات",
      is_active: true,
    },
  });

  console.log(`OPTICS ServiceType ID: ${opticsType.id}`);

  // 2. Fetch all companies
  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    select: {
      id: true,
      name: true,
    },
  });

  console.log(`Found ${companies.length} active companies to seed.`);

  let createdCount = 0;
  let updatedCount = 0;

  for (const company of companies) {
    // Default Optics Policy:
    // Ceiling: 500
    // Coverage: 100%
    // Frequency: 12 months
    const ceiling = 500;
    const coverage = 100;
    const frequency = 12;

    const existing = await prisma.servicePolicy.findUnique({
      where: {
        company_id_service_type_id: {
          company_id: company.id,
          service_type_id: opticsType.id,
        },
      },
    });

    if (existing) {
      await prisma.servicePolicy.update({
        where: { id: existing.id },
        data: {
          ceiling_amount: ceiling,
          coverage_percent: coverage,
          frequency_months: frequency,
          is_active: true,
        },
      });
      updatedCount++;
    } else {
      await prisma.servicePolicy.create({
        data: {
          company_id: company.id,
          service_type_id: opticsType.id,
          ceiling_amount: ceiling,
          coverage_percent: coverage,
          frequency_months: frequency,
          is_active: true,
        },
      });
      createdCount++;
    }
  }

  console.log(`Seeding Complete. Created: ${createdCount}, Updated: ${updatedCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
