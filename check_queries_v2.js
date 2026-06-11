
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    const deletedBeneficiariesCount = await prisma.beneficiary.count({
      where: { deleted_at: { not: null } },
    });
    
    const totalBeneficiariesCount = await prisma.beneficiary.count();
    const activeBeneficiariesCount = await prisma.beneficiary.count({
      where: { deleted_at: null }
    });

    const totalCardsCount = await prisma.cardIssuanceRegistry.count();

    console.log(`--- Beneficiary Table ---`);
    console.log(`Total: ${totalBeneficiariesCount}`);
    console.log(`Active (deleted_at is null): ${activeBeneficiariesCount}`);
    console.log(`Deleted (deleted_at is NOT null): ${deletedBeneficiariesCount}`);

    console.log(`\n--- CardIssuanceRegistry Table ---`);
    console.log(`Total Unique Cards: ${totalCardsCount}`);

    // Gap analysis: Cards in registry but not in Beneficiary
    // This might be slow if the table is huge, but 15k is fine.
    const registryCards = await prisma.cardIssuanceRegistry.findMany({
      select: { card_number_upper: true }
    });
    const registrySet = new Set(registryCards.map(c => c.card_number_upper));

    const beneficiaryCards = await prisma.beneficiary.findMany({
      select: { card_number: true }
    });
    const beneficiarySet = new Set(beneficiaryCards.map(b => b.card_number.toUpperCase()));

    let cardsInRegistryNotInBeneficiary = 0;
    for (const card of registrySet) {
      if (!beneficiarySet.has(card)) {
        cardsInRegistryNotInBeneficiary++;
      }
    }

    let cardsInBeneficiaryNotInRegistry = 0;
    for (const card of beneficiarySet) {
      if (!registrySet.has(card)) {
        cardsInBeneficiaryNotInRegistry++;
      }
    }

    console.log(`\n--- Gap Analysis ---`);
    console.log(`Cards in Registry but NOT in Beneficiary: ${cardsInRegistryNotInBeneficiary}`);
    console.log(`Cards in Beneficiary but NOT in Registry: ${cardsInBeneficiaryNotInRegistry}`);
    console.log(`Total registry cards minus deleted beneficiaries: ${totalCardsCount - deletedBeneficiariesCount}`);

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
