const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

function loadDatabaseUrl() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env file not found");
  }

  const content = fs.readFileSync(envPath, "utf8");
  const line = content
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("DATABASE_URL="));

  if (!line) {
    throw new Error("DATABASE_URL not found in .env");
  }

  let value = line.slice("DATABASE_URL=".length).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env.DATABASE_URL = value;
}

function canonicalCard(card) {
  const c = String(card || "").trim().toUpperCase();
  if (!/^WAB2025\d+$/.test(c)) return c;
  const digits = c.slice(7).replace(/^0+/, "") || "0";
  return `WAB2025${digits}`;
}

async function main() {
  loadDatabaseUrl();
  const prisma = new PrismaClient();

  try {
    const total = await prisma.beneficiary.count();
    const activeRows = await prisma.beneficiary.findMany({
      where: { deleted_at: null },
      select: { id: true, name: true, card_number: true, birth_date: true },
    });

    const exact = await prisma.$queryRaw`
      SELECT card_number, COUNT(*)::int AS cnt
      FROM "Beneficiary"
      WHERE deleted_at IS NULL
      GROUP BY card_number
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, card_number
      LIMIT 50
    `;

    const byCanon = new Map();
    for (const r of activeRows) {
      const key = canonicalCard(r.card_number);
      const arr = byCanon.get(key) || [];
      arr.push(r);
      byCanon.set(key, arr);
    }

    const zeroVariants = [];
    for (const [key, arr] of byCanon.entries()) {
      if (arr.length <= 1) continue;
      const cards = [...new Set(arr.map((x) => String(x.card_number).trim().toUpperCase()))];
      if (cards.length > 1) {
        zeroVariants.push({
          canonical_card: key,
          count: arr.length,
          cards,
          sample_names: [...new Set(arr.map((x) => x.name))].slice(0, 6),
        });
      }
    }

    const byName = new Map();
    for (const r of activeRows) {
      const nameKey = String(r.name || "").trim().replace(/\s+/g, " ").toUpperCase();
      if (!nameKey) continue;
      const arr = byName.get(nameKey) || [];
      arr.push(r);
      byName.set(nameKey, arr);
    }

    const sameNameMultiCards = [];
    for (const [name, arr] of byName.entries()) {
      const cards = [...new Set(arr.map((x) => String(x.card_number).trim().toUpperCase()))];
      if (cards.length > 1) {
        sameNameMultiCards.push({ name, count: arr.length, cards: cards.slice(0, 8) });
      }
    }

    console.log("=== SUMMARY ===");
    console.log(`total_beneficiaries: ${total}`);
    console.log(`active_beneficiaries: ${activeRows.length}`);
    console.log(`exact_duplicate_card_groups: ${exact.length}`);
    console.log(`zero_variant_groups: ${zeroVariants.length}`);
    console.log(`same_name_multi_card_groups: ${sameNameMultiCards.length}`);

    console.log("\n=== exact duplicate cards (top 50) ===");
    for (const row of exact) {
      console.log(`${row.card_number} => ${row.cnt}`);
    }

    console.log("\n=== zero-variant groups (top 50) ===");
    for (const g of zeroVariants.slice(0, 50)) {
      console.log(`${g.canonical_card} => ${g.count}`);
      console.log(`  cards: ${g.cards.join(", ")}`);
      console.log(`  names: ${g.sample_names.join(" | ")}`);
    }

    console.log("\n=== same-name multi-cards (top 50) ===");
    for (const g of sameNameMultiCards.slice(0, 50)) {
      console.log(`${g.name} => ${g.count}`);
      console.log(`  cards: ${g.cards.join(", ")}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Duplicate check failed:", err.message || err);
  process.exit(1);
});
