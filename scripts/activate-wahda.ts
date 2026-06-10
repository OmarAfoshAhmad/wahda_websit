import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const wahda = await prisma.insuranceCompany.findFirst({
    where: { name: { contains: "الوحدة" } }
  });

  if (!wahda) {
    console.log("Wahda not found!");
    return;
  }

  // 1. Activate the company
  await prisma.insuranceCompany.update({
    where: { id: wahda.id },
    data: { is_active: true }
  });

  console.log(`Activated company: ${wahda.name}`);

  const opticsType = await prisma.serviceType.findUnique({ where: { code: "OPTICS" } });
  const dentalType = await prisma.serviceType.findUnique({ where: { code: "DENTAL" } });

  // 2. Disable Dental
  const dentalPolicy = await prisma.servicePolicy.findUnique({
    where: { company_id_service_type_id: { company_id: wahda.id, service_type_id: dentalType!.id } }
  });
  
  if (dentalPolicy) {
    await prisma.servicePolicy.update({
      where: { id: dentalPolicy.id },
      data: { is_active: false }
    });
  }

  // 3. Enable Optics (0% Copay -> 100% Coverage, 24 months)
  await prisma.servicePolicy.upsert({
    where: { company_id_service_type_id: { company_id: wahda.id, service_type_id: opticsType!.id } },
    update: {
      is_active: true,
      coverage_percent: 100,
      frequency_months: 24,
      ceiling_amount: 500
    },
    create: {
      company_id: wahda.id,
      service_type_id: opticsType!.id,
      is_active: true,
      coverage_percent: 100,
      frequency_months: 24,
      ceiling_amount: 500
    }
  });

  console.log("Wahda optics policy updated successfully.");
}

main().finally(() => prisma.$disconnect());
