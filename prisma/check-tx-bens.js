const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== Checking JMR Transactions ===");
  const jmrTxs = await prisma.transaction.findMany({
    where: { company: { code: "JMR" } },
    include: { beneficiary: { include: { company: true } } }
  });

  let jmrMatched = 0;
  let jmrMismatched = 0;
  const jmrMismatches = [];

  for (const tx of jmrTxs) {
    if (tx.beneficiary && tx.beneficiary.company_id === tx.company_id) {
      jmrMatched++;
    } else {
      jmrMismatched++;
      jmrMismatches.push({
        txId: tx.id,
        txCompany: tx.company_id,
        benName: tx.beneficiary ? tx.beneficiary.name : "N/A",
        benCompany: tx.beneficiary ? tx.beneficiary.company_id : "N/A"
      });
    }
  }

  console.log(`JMR Txs matching beneficiary company: ${jmrMatched}`);
  console.log(`JMR Txs mismatching beneficiary company: ${jmrMismatched}`);
  if (jmrMismatches.length > 0) {
    console.log("Sample JMR mismatches:", jmrMismatches.slice(0, 5));
  }

  console.log("\n=== Checking LCC Transactions ===");
  const lccTxs = await prisma.transaction.findMany({
    where: { company: { code: "LCC" } },
    include: { beneficiary: { include: { company: true } } }
  });

  let lccMatched = 0;
  let lccMismatched = 0;
  const lccMismatches = [];

  for (const tx of lccTxs) {
    if (tx.beneficiary && tx.beneficiary.company_id === tx.company_id) {
      lccMatched++;
    } else {
      lccMismatched++;
      lccMismatches.push({
        txId: tx.id,
        txCompany: tx.company_id,
        benName: tx.beneficiary ? tx.beneficiary.name : "N/A",
        benCompany: tx.beneficiary ? tx.beneficiary.company_id : "N/A"
      });
    }
  }

  console.log(`LCC Txs matching beneficiary company: ${lccMatched}`);
  console.log(`LCC Txs mismatching beneficiary company: ${lccMismatched}`);
  if (lccMismatches.length > 0) {
    console.log("Sample LCC mismatches:", lccMismatches.slice(0, 5));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
