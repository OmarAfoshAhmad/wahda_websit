const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const dups = await prisma.$queryRaw`
    SELECT beneficiary_id, COUNT(*)::int AS import_count
    FROM "Transaction"
    WHERE type='IMPORT' AND is_cancelled=false
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  `;

  const ids = dups.map((d) => d.beneficiary_id);
  if (ids.length === 0) {
    console.log(JSON.stringify({ duplicateBeneficiaries: 0 }, null, 2));
    return;
  }

  const beneficiaries = await prisma.beneficiary.findMany({
    where: { id: { in: ids } },
    select: { id: true, card_number: true, name: true },
  });
  const benById = new Map(beneficiaries.map((b) => [b.id, b]));

  const tx = await prisma.transaction.findMany({
    where: {
      beneficiary_id: { in: ids },
      type: "IMPORT",
      is_cancelled: false,
    },
    orderBy: [{ beneficiary_id: "asc" }, { created_at: "asc" }],
    select: { beneficiary_id: true, amount: true, created_at: true, facility_id: true },
  });

  const byBen = new Map();
  for (const t of tx) {
    const arr = byBen.get(t.beneficiary_id) || [];
    arr.push(t);
    byBen.set(t.beneficiary_id, arr);
  }

  let exactlyTwo = 0;
  let moreThanTwo = 0;
  let crossDay = 0;
  let sameDay = 0;
  let maxGapDays = 0;

  const samples = [];

  for (const [bid, arr] of byBen.entries()) {
    if (arr.length === 2) exactlyTwo += 1;
    if (arr.length > 2) moreThanTwo += 1;

    const first = new Date(arr[0].created_at);
    const last = new Date(arr[arr.length - 1].created_at);
    const gapDays = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24);
    if (gapDays >= 1) crossDay += 1;
    else sameDay += 1;
    if (gapDays > maxGapDays) maxGapDays = gapDays;

    const ben = benById.get(bid);
    if (samples.length < 25) {
      samples.push({
        card: ben?.card_number || bid,
        name: ben?.name || "",
        importCount: arr.length,
        amounts: arr.map((x) => Number(x.amount)),
        firstAt: arr[0].created_at,
        lastAt: arr[arr.length - 1].created_at,
        gapDays: Number(gapDays.toFixed(2)),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        duplicateBeneficiaries: ids.length,
        exactlyTwo,
        moreThanTwo,
        crossDay,
        sameDay,
        maxGapDays: Number(maxGapDays.toFixed(2)),
        samples,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
