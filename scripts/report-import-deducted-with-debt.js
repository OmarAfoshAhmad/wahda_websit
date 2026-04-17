const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const rows = await prisma.$queryRaw`
    WITH member_financials AS (
      SELECT
        b.id,
        b.name,
        b.card_number,
        REGEXP_REPLACE(b.card_number, '([WSDMFHV][0-9]*)$', '') AS family_base_card,
        b.total_balance::float8 AS total_balance,
        b.remaining_balance::float8 AS remaining_balance,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'IMPORT' THEN t.amount ELSE 0 END), 0)::float8 AS import_deducted,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' AND t.type <> 'IMPORT' THEN t.amount ELSE 0 END), 0)::float8 AS manual_deducted,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)::float8 AS consumed_total
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
      GROUP BY b.id, b.name, b.card_number, b.total_balance, b.remaining_balance
    ),
    debtor_members AS (
      SELECT
        *,
        GREATEST(0, consumed_total - total_balance)::float8 AS debt_amount
      FROM member_financials
      WHERE consumed_total > total_balance
    ),
    target_families AS (
      SELECT DISTINCT family_base_card
      FROM debtor_members
      WHERE import_deducted > 0
    )
    SELECT
      m.family_base_card,
      m.id,
      m.name,
      m.card_number,
      m.total_balance,
      m.remaining_balance,
      m.import_deducted,
      m.manual_deducted,
      m.consumed_total,
      GREATEST(0, m.consumed_total - m.total_balance)::float8 AS debt_amount
    FROM member_financials m
    WHERE m.family_base_card IN (SELECT family_base_card FROM target_families)
    ORDER BY m.family_base_card, m.card_number;
  `;

  const grouped = new Map();
  for (const r of rows) {
    const base = r.family_base_card;
    if (!grouped.has(base)) {
      grouped.set(base, {
        family_base_card: base,
        members: [],
        family_total_balance: 0,
        family_remaining_balance: 0,
        family_import_deducted: 0,
        family_manual_deducted: 0,
        family_consumed_total: 0,
        family_debt_total: 0,
        debt_members_count: 0,
      });
    }

    const g = grouped.get(base);
    const member = {
      id: r.id,
      name: r.name,
      card_number: r.card_number,
      total_balance: Number(r.total_balance),
      remaining_balance: Number(r.remaining_balance),
      import_deducted: Number(r.import_deducted),
      manual_deducted: Number(r.manual_deducted),
      consumed_total: Number(r.consumed_total),
      debt_amount: Number(r.debt_amount),
      is_debtor: Number(r.debt_amount) > 0,
    };

    g.members.push(member);
    g.family_total_balance += member.total_balance;
    g.family_remaining_balance += member.remaining_balance;
    g.family_import_deducted += member.import_deducted;
    g.family_manual_deducted += member.manual_deducted;
    g.family_consumed_total += member.consumed_total;
    g.family_debt_total += member.debt_amount;
    if (member.is_debtor) g.debt_members_count += 1;
  }

  const families = [...grouped.values()]
    .filter((f) => f.family_import_deducted > 0 && f.family_debt_total > 0)
    .sort((a, b) => b.family_debt_total - a.family_debt_total);

  const output = {
    generated_at: new Date().toISOString(),
    total_families: families.length,
    total_members_in_scope: families.reduce((s, f) => s + f.members.length, 0),
    total_family_import_deducted: families.reduce((s, f) => s + f.family_import_deducted, 0),
    total_family_debt: families.reduce((s, f) => s + f.family_debt_total, 0),
    families,
  };

  const outPath = path.join(process.cwd(), "reports", `families-import-deducted-with-debt-${nowStamp()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

  console.log("REPORT_PATH", outPath);
  console.log("TOTAL_FAMILIES", output.total_families);
  console.log("TOTAL_FAMILY_IMPORT_DEDUCTED", output.total_family_import_deducted.toFixed(3));
  console.log("TOTAL_FAMILY_DEBT", output.total_family_debt.toFixed(3));

  const top = families.slice(0, 10).map((f) => ({
    family_base_card: f.family_base_card,
    family_import_deducted: f.family_import_deducted,
    family_debt_total: f.family_debt_total,
    debt_members_count: f.debt_members_count,
    members_count: f.members.length,
  }));
  console.log("TOP10", JSON.stringify(top, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
