import prisma from "../src/lib/prisma";

async function main() {
  const facility = await prisma.facility.findFirst({
    where: { username: "aya_d" }
  });
  console.log("AYA_D Database Record:", JSON.stringify(facility, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
