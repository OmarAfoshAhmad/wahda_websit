const fs = require('fs');

let file = 'src/app/admin/duplicates/page.tsx';
let code = fs.readFileSync(file, 'utf8');

const regex = /const visibleRemainingById = await getLedgerRemainingByBeneficiaryIds\(visibleIds\);\s*const detailsMap = new Map\(fullDetails\.map\(\s*d => \[d\.id, d\]\s*\)\);/g;

const newCode = `const visibleRemainingById = await getLedgerRemainingByBeneficiaryIds(visibleIds);

  const visibleBaseCards = new Set<string>();
  const allVisibleMembers = [...zeroPage.items.flatMap(g => g.members), ...namePage.items.flatMap(g => g.members)];
  for (const m of allVisibleMembers) {
    const match = m.card_number.match(/^(.*?)([WSDMFHV])(\\d+)$/i);
    if (match) visibleBaseCards.add(match[1]);
  }

  const heads = visibleBaseCards.size > 0 ? await prisma.beneficiary.findMany({
    where: { card_number: { in: Array.from(visibleBaseCards) }, deleted_at: null },
    select: { card_number: true, name: true },
  }) : [];
  const headNameMap = new Map(heads.map(h => [h.card_number, h.name]));

  const detailsMap = new Map(fullDetails.map(d => [d.id, d]));`;

code = code.replace(regex, newCode);

const enrichRegex = /const enrich = \(m: \(typeof zeroPage\.items\)\[number\]\["members"\]\[number\]\) => \(\{[\s\S]*?\}\);/g;

const enrichNewCode = `const enrich = (m: (typeof zeroPage.items)[number]["members"][number]) => {
    let headName = null;
    const match = m.card_number.match(/^(.*?)([WSDMFHV])(\\d+)$/i);
    if (match) {
      headName = headNameMap.get(match[1]) ?? match[1];
    } else {
      headName = m.name; // If no match, they are the head
    }
    return {
      ...m,
      head_of_household: headName,
      status: detailsMap.get(m.id)?.status ?? "ACTIVE",
      remaining_balance: visibleRemainingById.get(m.id) ?? 0,
    };
  };`;

code = code.replace(enrichRegex, enrichNewCode);

if (code.includes('head_of_household: headName')) {
  fs.writeFileSync(file, code);
  console.log("Updated page.tsx with head names!");
} else {
  console.log("Failed to match regex.");
}
