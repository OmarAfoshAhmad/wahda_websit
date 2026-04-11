const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const date = new Date("2026-04-01");
  const logs = await prisma.auditLog.findMany({
    where: {
      created_at: {
        gte: new Date("2026-04-01T00:00:00Z"),
        lt: new Date("2026-04-02T00:00:00Z")
      }
    },
    orderBy: { created_at: "asc" }
  });

  const settings = await prisma.auditLog.findMany({
    where: { action: "SET_INITIAL_BALANCE" },
    orderBy: { created_at: "desc" }
  });

  let output = `Logs for 2026-04-01:\n${JSON.stringify(logs, null, 2)}\n\n`;
  output += `All Initial Balance Settings:\n${JSON.stringify(settings, null, 2)}\n`;

  fs.writeFileSync('c:\\Users\\Omar\\waad_temp_website\\db-output.txt', output);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
