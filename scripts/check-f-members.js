const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const count = await p.beneficiary.count({
    where: { card_number: { contains: "F" }, deleted_at: null },
  });
  console.log("عدد سجلات F:", count);

  const samples = await p.beneficiary.findMany({
    where: { card_number: { contains: "F" }, deleted_at: null },
    select: {
      card_number: true,
      name: true,
      status: true,
      created_at: true,
      total_balance: true,
      remaining_balance: true,
    },
    orderBy: { created_at: "desc" },
    take: 10,
  });

  console.log("\nآخر 10 سجلات:");
  samples.forEach((s) =>
    console.log(
      s.card_number,
      "|",
      s.name,
      "|",
      s.status,
      "| created:",
      s.created_at.toISOString(),
      "| total:",
      Number(s.total_balance),
      "| remaining:",
      Number(s.remaining_balance)
    )
  );

  // تحقق من أقدم وأحدث تاريخ إنشاء
  const oldest = await p.beneficiary.findFirst({
    where: { card_number: { contains: "F" }, deleted_at: null },
    orderBy: { created_at: "asc" },
    select: { created_at: true, card_number: true },
  });
  const newest = await p.beneficiary.findFirst({
    where: { card_number: { contains: "F" }, deleted_at: null },
    orderBy: { created_at: "desc" },
    select: { created_at: true, card_number: true },
  });

  console.log("\nأقدم سجل F:", oldest?.card_number, oldest?.created_at?.toISOString());
  console.log("أحدث سجل F:", newest?.card_number, newest?.created_at?.toISOString());
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
