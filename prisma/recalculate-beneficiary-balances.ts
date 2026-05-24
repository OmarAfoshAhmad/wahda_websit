import { PrismaClient } from "@prisma/client";
import { getCurrentInitialBalance } from "../src/lib/initial-balance";
import { seedConsumptionFromTransactions } from "../src/lib/wallet/engine";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Recalculating Beneficiary Balances and Seeding Wallet Consumptions ===");

  const initialBalance = await getCurrentInitialBalance();
  console.log(`Global Initial Balance fallback: ${initialBalance}`);

  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null }
  });

  const getPolicyCeiling = (company: typeof companies[number]) => {
    if (company.dental_ceiling !== null) {
      return Number(company.dental_ceiling);
    }
    if (company.general_ceiling !== null) {
      return Number(company.general_ceiling);
    }
    if (company.medicine_ceiling !== null) {
      return Number(company.medicine_ceiling);
    }
    return null;
  };

  for (const company of companies) {
    const ceiling = getPolicyCeiling(company) ?? initialBalance;
    console.log(`Processing company: ${company.name} (${company.code}) | Target Ceiling: ${ceiling}`);

    // Get all active beneficiaries of this company
    const beneficiaries = await prisma.beneficiary.findMany({
      where: { company_id: company.id, deleted_at: null },
      include: {
        transactions: {
          where: { is_cancelled: false, type: { not: "CANCELLATION" } }
        }
      }
    });

    console.log(`Found ${beneficiaries.length} active beneficiaries.`);

    let updatedCount = 0;

    for (const ben of beneficiaries) {
      // Sum the actual company share of all non-cancelled transactions
      // In the dental transaction import, amount is company share, but let's look at amount and actual_company_share
      const txSum = ben.transactions.reduce((acc, tx) => {
        const share = tx.actual_company_share ?? tx.original_company_share ?? tx.amount;
        return acc + Number(share);
      }, 0);

      const newTotalBalance = ceiling;
      const newRemainingBalance = Math.max(0, newTotalBalance - txSum);
      const isFinished = newRemainingBalance <= 0;

      // Check if update is needed to save database writes
      const needsUpdate = 
        Number(ben.total_balance) !== newTotalBalance || 
        Number(ben.remaining_balance) !== newRemainingBalance ||
        ben.status !== (isFinished ? "FINISHED" : "ACTIVE");

      if (needsUpdate) {
        await prisma.beneficiary.update({
          where: { id: ben.id },
          data: {
            total_balance: newTotalBalance,
            remaining_balance: newRemainingBalance,
            status: isFinished ? "FINISHED" : "ACTIVE",
            completed_via: isFinished ? "IMPORT" : ben.completed_via
          }
        });
        updatedCount++;
      }

      // Pre-seed/sync WalletConsumption for this beneficiary
      await seedConsumptionFromTransactions(ben.id, company.id, 2026);
    }

    console.log(`Company ${company.code}: Updated ${updatedCount} beneficiaries.`);
  }

  console.log("=== Recalculation and Sync Completed! ===");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
