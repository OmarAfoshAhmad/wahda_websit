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
          company_id: true
        }
      }
    }
  });

  console.log(`Found ${txs.length} transactions to reconcile.`);

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

  const companyUpdates = {}; // company_id -> Array of transaction ids

  for (const tx of txs) {
    const ben = tx.beneficiary;
    if (!ben) continue;

    let targetCompanyId = ben.company_id;
    if (!targetCompanyId) {
      const matched = matchCompanyForCard(ben.card_number);
      if (matched) {
        targetCompanyId = matched.id;
      }
    }

    if (targetCompanyId) {
      if (!companyUpdates[targetCompanyId]) {
        companyUpdates[targetCompanyId] = [];
      }
      companyUpdates[targetCompanyId].push(tx.id);
    }
  }

  console.log("Starting reconciliation update in database...");
  let totalUpdated = 0;

  for (const [companyId, txIds] of Object.entries(companyUpdates)) {
    const comp = companies.find(c => c.id === companyId);
    console.log(`Updating ${txIds.length} transactions for company ${comp ? comp.name : companyId}...`);
    
    // Chunk updates to prevent query size limit issues
    const chunkSize = 1000;
    for (let i = 0; i < txIds.length; i += chunkSize) {
      const chunk = txIds.slice(i, i + chunkSize);
      const res = await prisma.transaction.updateMany({
        where: { id: { in: chunk } },
        data: { company_id: companyId }
      });
      totalUpdated += res.count;
    }
  }

  console.log(`Reconciliation finished! Updated ${totalUpdated} transactions.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
