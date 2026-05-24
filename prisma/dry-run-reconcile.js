const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("Fetching transactions with null company_id...");
  const txs = await prisma.transaction.findMany({
    where: { company_id: null },
    include: {
      beneficiary: {
        select: {
          id: true,
          card_number: true,
          company_id: true,
          company: true
        }
      }
    }
  });

  console.log(`Found ${txs.length} transactions with null company_id.`);

  let resolvedFromBenCompany = 0;
  let resolvedFromCardPattern = 0;
  let unresolved = 0;

  const companies = await prisma.insuranceCompany.findMany();

  const matchCompanyForCard = (cardNumber) => {
    if (!cardNumber) return null;
    const upper = cardNumber.toUpperCase().trim();
    for (const company of companies) {
      if (!company.card_pattern) continue;
      try {
        const regex = new RegExp(company.card_pattern);
        if (regex.test(upper)) {
          return company;
        }
      } catch (e) {}
    }
    for (const company of companies) {
      if (company.card_pattern && upper.startsWith(company.code)) {
        return company;
      }
    }
    return null;
  };

  const companyStats = {};

  for (const tx of txs) {
    const ben = tx.beneficiary;
    if (!ben) {
      unresolved++;
      continue;
    }

    let targetCompanyId = ben.company_id;
    let method = "beneficiary_company";

    if (targetCompanyId) {
      resolvedFromBenCompany++;
    } else {
      // Try to match card pattern
      const matched = matchCompanyForCard(ben.card_number);
      if (matched) {
        targetCompanyId = matched.id;
        method = "card_pattern";
        resolvedFromCardPattern++;
      } else {
        unresolved++;
        continue;
      }
    }

    if (targetCompanyId) {
      const comp = companies.find(c => c.id === targetCompanyId);
      const name = comp ? `${comp.name} (${comp.code})` : "Unknown";
      companyStats[name] = (companyStats[name] || 0) + 1;
    }
  }

  console.log("\n=== Reconciliation Results ===");
  console.log(`Resolved from Beneficiary's existing Company: ${resolvedFromBenCompany}`);
  console.log(`Resolved by matching Beneficiary's Card Pattern: ${resolvedFromCardPattern}`);
  console.log(`Unresolved transactions: ${unresolved}`);
  console.log("\nDestination Companies for Resolved Transactions:");
  console.log(JSON.stringify(companyStats, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
