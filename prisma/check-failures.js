const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.importJob.findMany({
    orderBy: { created_at: "desc" },
    take: 20
  });

  console.log("Searching skipped rows for Cement / Customs:");
  for (const job of jobs) {
    if (!job.skipped_rows_report) continue;
    const report = JSON.parse(JSON.stringify(job.skipped_rows_report));
    if (!report.rows) continue;

    const matchedRows = report.rows.filter(row => {
      const card = String(row.card || row.card_number || "").toUpperCase();
      const name = String(row.name || "").toUpperCase();
      const reason = String(row.reason || "").toUpperCase();
      return card.includes("JMR") || card.includes("LCC") || name.includes("اسمنت") || name.includes("جمارك");
    });

    if (matchedRows.length > 0) {
      console.log(`\nJob ID: ${job.id} (Created at: ${job.created_at})`);
      console.log(`Skipped rows count matching JMR/LCC: ${matchedRows.length}`);
      console.log(JSON.stringify(matchedRows.slice(0, 10), null, 2));
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
