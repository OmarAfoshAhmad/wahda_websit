const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // Let's get the card numbers of legacy beneficiaries
  const legacyBeneficiaries = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      is_legacy_card: true,
    },
    select: { card_number: true, name: true }
  });

  console.log(`Found ${legacyBeneficiaries.length} legacy beneficiaries.`);

  // Let's extract digits from some legacy beneficiary cards and search in CardIssuanceRegistryAll
  let matchedCount = 0;
  let matches = [];

  for (const b of legacyBeneficiaries) {
    // Extract digits from beneficiary card
    const bDigits = b.card_number.replace(/\D/g, ""); // e.g. "20259436" -> "20259436"
    // Let's extract the actual sequential part. All start with WAB2025.
    // If it starts with WAB2025, let's extract the part after 2025.
    const bSeq = b.card_number.replace(/^WAB20250*/, ""); // "WAB20259436" -> "9436"
    
    // Find in CardIssuanceRegistryAll where card_number contains bSeq or canonical_card matches
    const regMatches = await prisma.$queryRaw`
      SELECT card_number, canonical_card, batch_number, beneficiary_name
      FROM "CardIssuanceRegistryAll"
      WHERE canonical_card = ${b.card_number}
         OR canonical_card = ${b.card_number.toUpperCase()}
         OR card_number_upper = ${b.card_number.toUpperCase()}
         OR REGEXP_REPLACE(card_number_upper, '[^0-9]', '', 'g') = REGEXP_REPLACE(${b.card_number}, '[^0-9]', '', 'g')
      LIMIT 1
    `;

    if (regMatches.length > 0) {
      matchedCount++;
      if (matches.length < 10) {
        matches.push({
          beneficiary_card: b.card_number,
          beneficiary_name: b.name,
          registry_card: regMatches[0].card_number,
          registry_canonical: regMatches[0].canonical_card,
          batch_number: regMatches[0].batch_number,
          registry_name: regMatches[0].beneficiary_name
        });
      }
    }
  }

  console.log(`Matched ${matchedCount} legacy beneficiaries using flexible search.`);
  console.log("Samples of matches:", JSON.stringify(matches, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
