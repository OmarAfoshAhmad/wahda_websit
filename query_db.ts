import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("--- 1. Beneficiaries not in CardIssuanceRegistry ---");
  const beneficiariesNotInRegistry = await prisma.$queryRaw`
    SELECT b.name, b.card_number
    FROM "Beneficiary" b
    WHERE NOT EXISTS (
      SELECT 1 FROM "CardIssuanceRegistry" ciri 
      WHERE UPPER(TRIM(b.card_number)) = ciri.card_number_upper
    )
    LIMIT 10
  `;
  console.log(beneficiariesNotInRegistry);

  console.log("\n--- 2. Cards in Registry not in Beneficiary ---");
  const cardsNotInBeneficiary = await prisma.$queryRaw`
    SELECT ciri.card_number, ciri.beneficiary_name, ciri.city
    FROM "CardIssuanceRegistry" ciri
    WHERE NOT EXISTS (
      SELECT 1 FROM "Beneficiary" b 
      WHERE UPPER(TRIM(b.card_number)) = ciri.card_number_upper
    )
    LIMIT 10
  `;
  console.log(cardsNotInBeneficiary);

  console.log("\n--- 3. Mismatch Patterns (Card Number formats) ---");
  const registrySamples = await prisma.$queryRaw`SELECT card_number FROM "CardIssuanceRegistry" LIMIT 5`;
  const beneficiarySamples = await prisma.$queryRaw`SELECT card_number FROM "Beneficiary" LIMIT 5`;
  console.log("Registry Samples:", registrySamples);
  console.log("Beneficiary Samples:", beneficiarySamples);

  console.log("\n--- 4. Most Frequent Cities among Unlinked Beneficiaries ---");
  // Since Beneficiary doesn't have city, we look at unlinked items in registry to see where potential beneficiaries might be
  const unlinkedCities = await prisma.$queryRaw`
    SELECT ciri.city, COUNT(*) as count
    FROM "CardIssuanceRegistry" ciri
    WHERE NOT EXISTS (
      SELECT 1 FROM "Beneficiary" b 
      WHERE UPPER(TRIM(b.card_number)) = ciri.card_number_upper
    )
    GROUP BY ciri.city
    ORDER BY count DESC
    LIMIT 10
  `;
  console.log(unlinkedCities);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
