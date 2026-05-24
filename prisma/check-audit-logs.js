const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.auditLog.findMany({
    where: {
      created_at: {
        gte: new Date("2026-05-22T00:00:00Z"),
        lt: new Date("2026-05-23T00:00:00Z")
      }
    },
    orderBy: { created_at: "asc" }
  });
  console.log("=== Audit Logs on 2026-05-22 ===");
  console.log(JSON.stringify(logs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
