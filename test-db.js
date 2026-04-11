const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const jobs = await prisma.importJob.findMany({
    select: { id: true, created_at: true, status: true, total_rows: true },
    orderBy: { created_at: "desc" },
    take: 20
  });

  const count = await prisma.importJob.count();

  let output = `Total Import Jobs: ${count}\n\n`;
  output += `Recent Jobs:\n${JSON.stringify(jobs, null, 2)}\n`;

  fs.writeFileSync('c:\\Users\\Omar\\waad_temp_website\\db-output.txt', output);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
