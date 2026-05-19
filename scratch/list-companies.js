const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.beneficiary.count({
    where: {
      AND: [
        {
          OR: [
            { company_id: "cmp7ha2km0000u9v8jse4ib5x" },
            { company_id: null }
          ]
        }
      ]
    }
  });
  console.log("Count for WAB or NULL using AND-OR:", count);
}

main().catch(err => {
  console.error(err);
}).finally(() => {
  prisma.$disconnect();
});
