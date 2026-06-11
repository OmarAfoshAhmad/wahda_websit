
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    // 1. Count beneficiaries where deleted_at is not null
    const deletedBeneficiariesCount = await prisma.beneficiary.count({
      where: {
        deleted_at: {
          not: null,
        },
      },
    });
    console.log(`Count of beneficiaries where deleted_at is not null: ${deletedBeneficiariesCount}`);

    // 2. Count unique cards in CardIssuanceRegistry
    // Assuming card_number_upper is the unique identifier as per schema
    const totalCardsCount = await prisma.cardIssuanceRegistry.count();
    console.log(`Count of unique cards in CardIssuanceRegistry: ${totalCardsCount}`);

    // 3. Comparison
    const gap = totalCardsCount - deletedBeneficiariesCount;
    console.log(`Difference (Gap): ${gap}`);

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
