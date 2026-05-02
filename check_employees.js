const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const employees = await prisma.facility.findMany({
    where: {
      is_employee: true,
      deleted_at: null
    },
    select: {
      username: true,
      is_employee: true,
      manager_permissions: true
    }
  });

  const processed = employees.map(e => ({
    username: e.username,
    is_employee: e.is_employee,
    cash_claim: e.manager_permissions?.cash_claim
  }));

  const count = processed.filter(e => e.cash_claim === true).length;

  console.log("Employees Data:");
  console.log(JSON.stringify(processed, null, 2));
  console.log("\nTotal with cash_claim true: " + count);
}

main().catch(console.error).finally(() => prisma.$disconnect());
