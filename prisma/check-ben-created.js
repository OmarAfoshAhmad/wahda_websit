const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const sampleJmr = await prisma.beneficiary.findFirst({
    where: { company_id: 'cmpgpi50z000uu9h4fh82k1ha', deleted_at: null },
    select: { created_at: true }
  });
  console.log("Sample JMR created_at:", sampleJmr ? sampleJmr.created_at : "none");

  const sampleLcc = await prisma.beneficiary.findFirst({
    where: { company_id: 'cmpgpi516000xu9h4b2zpk92x', deleted_at: null },
    select: { created_at: true }
  });
  console.log("Sample LCC created_at:", sampleLcc ? sampleLcc.created_at : "none");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
