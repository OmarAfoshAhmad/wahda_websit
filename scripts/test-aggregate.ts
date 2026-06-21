import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  try {
    const beneficiary = await prisma.beneficiary.findFirst();
    if (!beneficiary) return;

    const startDate = new Date(2026, 0, 1);
    const rDate = new Date();

    const agg = await prisma.transaction.aggregate({
      where: {
        beneficiary_id: beneficiary.id,
        type: "OPTICS",
        is_cancelled: false,
        created_at: { gte: startDate, lt: rDate },
      },
      _sum: { ceiling_consumed: true },
    });

    console.log("Success", agg);
  } catch (e) {
    console.error("Error:");
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
