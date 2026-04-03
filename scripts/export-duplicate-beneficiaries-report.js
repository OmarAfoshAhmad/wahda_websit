const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
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
  if (!/^WAB2025\d+/.test(c)) return c;
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;
  const digits = m[1].replace(/^0+/, "") || "0";
  const suffix = m[2] || "";
  return `WAB2025${digits}${suffix}`;
}

function zeroScore(card) {
  const c = String(card || "").trim().toUpperCase();
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return 0;
  const z = m[1].match(/^0+/);
  return z ? z[0].length : 0;
}

async function main() {
  loadDatabaseUrl();
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.beneficiary.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        name: true,
        card_number: true,
        birth_date: true,
        status: true,
        remaining_balance: true,
        created_at: true,
      },
      orderBy: { card_number: "asc" },
    });

    const byCanonical = new Map();
    for (const r of rows) {
      const key = canonicalCard(r.card_number);
      const arr = byCanonical.get(key) || [];
      arr.push(r);
      byCanonical.set(key, arr);
    }

    const zeroVariantGroups = [];
    for (const [canonical, arr] of byCanonical.entries()) {
      if (arr.length <= 1) continue;
      const uniqueCards = [...new Set(arr.map((x) => String(x.card_number).trim().toUpperCase()))];
      if (uniqueCards.length > 1) {
        const preferred = [...arr].sort((a, b) => {
          const z = zeroScore(b.card_number) - zeroScore(a.card_number);
          if (z !== 0) return z;
          return String(a.card_number).localeCompare(String(b.card_number));
        })[0];

        zeroVariantGroups.push({
          canonical,
          count: arr.length,
          preferredCard: preferred.card_number,
          preferredId: preferred.id,
          members: arr,
        });
      }
    }

    const byName = new Map();
    for (const r of rows) {
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
        sameNameMultiCards.push({
          name,
          count: arr.length,
          cards,
          members: arr,
        });
      }
    }

    const wb = new ExcelJS.Workbook();

    const summary = wb.addWorksheet("ملخص");
    summary.columns = [
      { header: "المؤشر", key: "metric", width: 45 },
      { header: "القيمة", key: "value", width: 20 },
    ];
    summary.addRows([
      { metric: "إجمالي المستفيدين النشطين", value: rows.length },
      { metric: "مجموعات اختلاف الأصفار بعد 2025", value: zeroVariantGroups.length },
      { metric: "مجموعات الاسم المتكرر مع بطاقات متعددة", value: sameNameMultiCards.length },
      { metric: "تاريخ إنشاء التقرير", value: new Date().toISOString() },
    ]);
    summary.getRow(1).font = { bold: true };

    const zeroSheet = wb.addWorksheet("تكرار الأصفار");
    zeroSheet.columns = [
      { header: "canonical_card", key: "canonical", width: 26 },
      { header: "count", key: "count", width: 10 },
      { header: "preferred_card_to_keep", key: "preferredCard", width: 28 },
      { header: "preferred_id_to_keep", key: "preferredId", width: 30 },
      { header: "member_id", key: "memberId", width: 30 },
      { header: "name", key: "name", width: 32 },
      { header: "card_number", key: "card", width: 24 },
      { header: "status", key: "status", width: 14 },
      { header: "remaining_balance", key: "balance", width: 16 },
      { header: "created_at", key: "createdAt", width: 22 },
      { header: "suggested_action", key: "action", width: 18 },
    ];

    for (const group of zeroVariantGroups) {
      for (const m of group.members) {
        zeroSheet.addRow({
          canonical: group.canonical,
          count: group.count,
          preferredCard: group.preferredCard,
          preferredId: group.preferredId,
          memberId: m.id,
          name: m.name,
          card: m.card_number,
          status: m.status,
          balance: Number(m.remaining_balance),
          createdAt: m.created_at.toISOString(),
          action: m.id === group.preferredId ? "KEEP" : "MERGE_DELETE",
        });
      }
    }
    zeroSheet.getRow(1).font = { bold: true };

    const nameSheet = wb.addWorksheet("نفس الاسم بطاقات مختلفة");
    nameSheet.columns = [
      { header: "normalized_name", key: "name", width: 36 },
      { header: "count", key: "count", width: 10 },
      { header: "member_id", key: "memberId", width: 30 },
      { header: "display_name", key: "displayName", width: 32 },
      { header: "card_number", key: "card", width: 24 },
      { header: "birth_date", key: "birthDate", width: 18 },
      { header: "status", key: "status", width: 14 },
      { header: "remaining_balance", key: "balance", width: 16 },
    ];

    for (const group of sameNameMultiCards) {
      for (const m of group.members) {
        nameSheet.addRow({
          name: group.name,
          count: group.count,
          memberId: m.id,
          displayName: m.name,
          card: m.card_number,
          birthDate: m.birth_date ? new Date(m.birth_date).toISOString().slice(0, 10) : "",
          status: m.status,
          balance: Number(m.remaining_balance),
        });
      }
    }
    nameSheet.getRow(1).font = { bold: true };

    const outDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
    const outPath = path.join(outDir, `duplicate-beneficiaries-report-${stamp}.xlsx`);
    await wb.xlsx.writeFile(outPath);

    console.log(`REPORT_CREATED=${outPath}`);
    console.log(`ZERO_VARIANT_GROUPS=${zeroVariantGroups.length}`);
    console.log(`SAME_NAME_MULTI_CARD_GROUPS=${sameNameMultiCards.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Export failed:", err.message || err);
  process.exit(1);
});
