import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkSum() {
  const beneficiaryId = (await prisma.beneficiary.findFirst({ where: { card_number: "WAAD20250001" } }))!.id;
  
  const now = new Date();
  const fiscalYear = now.getFullYear();
  const startDate = new Date(fiscalYear, 0, 1);
  const endDate = new Date(fiscalYear, 11, 31, 23, 59, 59);

  const policyServiceType = "OPTICS";
  const targetServiceCategories = [policyServiceType];

  console.log("Checking for beneficiary:", beneficiaryId);
  console.log("Date range:", startDate, "to", endDate);
  
  const rawQuery = await prisma.transaction.findMany({
    where: {
        beneficiary_id: beneficiaryId,
        is_cancelled: false,
        created_at: { gte: startDate, lte: endDate },
        OR: [
          { service_category: { in: targetServiceCategories } },
          { service_category: null, type: policyServiceType as any },
        ]
      }
  });

  console.log("Matched transactions:", rawQuery.map(t => ({ id: t.id, created_at: t.created_at, ceiling_consumed: t.ceiling_consumed, service_category: t.service_category })));

  const sum = await prisma.transaction.aggregate({
    where: {
      beneficiary_id: beneficiaryId,
      is_cancelled: false,
      created_at: { gte: startDate, lte: endDate },
      OR: [
        { service_category: { in: targetServiceCategories } },
        { service_category: null, type: policyServiceType as any },
      ]
    },
    _sum: { ceiling_consumed: true }
  });
  
  console.log("Sum result:", sum._sum.ceiling_consumed);
}

checkSum().finally(() => prisma.$disconnect());
