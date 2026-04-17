import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type OverdrawnRow = {
  id: string;
  card_number: string;
  name: string;
  status: string;
  completed_via: string | null;
  total_balance: number;
  spent_non_cancel: number;
  debt_amount: number;
};

type TxAgg = {
  beneficiary_id: string;
  import_amount: number;
  medicine_amount: number;
  supplies_amount: number;
  other_amount: number;
  active_non_cancel_count: number;
  cancelled_count: number;
};

function q(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes("\"")) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

function diagnosis(row: {
  totalBalance: number;
  debt: number;
  status: string;
  completedVia: string | null;
  importAmount: number;
  manualAmount: number;
}) {
  const reasons: string[] = [];

  if (row.totalBalance <= 0) {
    reasons.push("الرصيد الكلي صفري أو سالب بينما توجد حركات صرف");
  }

  if (row.completedVia === "EXCEEDED_BALANCE") {
    reasons.push("موسوم مسبقا كحالة تجاوز رصيد");
  }

  if (row.status === "ACTIVE") {
    reasons.push("الحالة ما زالت نشطة رغم وجود دين");
  }

  if (row.importAmount >= row.manualAmount) {
    reasons.push("الاستيراد مساهم رئيسي في الصرف");
  } else {
    reasons.push("الخصومات اليدوية مساهم رئيسي في الصرف");
  }

  let action = "مراجعة دفتر الحركات ثم قيد تسوية/إلغاء يدوي حسب السياسة";

  if (row.totalBalance <= 0) {
    action = "إعادة تقييم total_balance للحالة أو إلغاء حركة/حركات خاطئة";
  } else if (row.debt <= 100) {
    action = "تسوية يدوية مباشرة للدين الصغير ثم إعادة فحص";
  } else {
    action = "تسوية على دفعات + مراجعة مصدر الدين (IMPORT مقابل خصومات يدوية)";
  }

  return { reason: reasons.join(" | "), action };
}

async function main() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const reportsDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const rows = await prisma.$queryRaw<OverdrawnRow[]>`
    SELECT
      b.id,
      b.card_number,
      b.name,
      b.status::text,
      b.completed_via,
      b.total_balance::float8,
      COALESCE(SUM(t.amount), 0)::float8 AS spent_non_cancel,
      (COALESCE(SUM(t.amount), 0)::float8 - b.total_balance::float8) AS debt_amount
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t
      ON t.beneficiary_id = b.id
      AND t.is_cancelled = false
      AND t.type <> 'CANCELLATION'
    WHERE b.deleted_at IS NULL
    GROUP BY b.id, b.card_number, b.name, b.status, b.completed_via, b.total_balance
    HAVING (b.total_balance::float8 - COALESCE(SUM(t.amount), 0)::float8) < -0.01
    ORDER BY debt_amount DESC, b.card_number ASC
  `;

  if (rows.length === 0) {
    console.log(JSON.stringify({ totalCases: 0, message: "No official overdrawn rows." }, null, 2));
    return;
  }

  const ids = rows.map((r) => r.id);

  const txAgg = await prisma.$queryRaw<TxAgg[]>`
    SELECT
      t.beneficiary_id,
      COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'IMPORT' THEN t.amount ELSE 0 END), 0)::float8 AS import_amount,
      COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'MEDICINE' THEN t.amount ELSE 0 END), 0)::float8 AS medicine_amount,
      COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'SUPPLIES' THEN t.amount ELSE 0 END), 0)::float8 AS supplies_amount,
      COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type NOT IN ('IMPORT', 'MEDICINE', 'SUPPLIES', 'CANCELLATION') THEN t.amount ELSE 0 END), 0)::float8 AS other_amount,
      COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN 1 ELSE 0 END), 0)::int AS active_non_cancel_count,
      COALESCE(SUM(CASE WHEN t.is_cancelled = true THEN 1 ELSE 0 END), 0)::int AS cancelled_count
    FROM "Transaction" t
    WHERE t.beneficiary_id IN (${Prisma.join(ids)})
    GROUP BY t.beneficiary_id
  `;

  const txById = new Map(txAgg.map((r) => [r.beneficiary_id, r]));

  const header = [
    "card_number",
    "name",
    "status",
    "completed_via",
    "total_balance",
    "spent_non_cancel",
    "debt_amount",
    "import_amount",
    "medicine_amount",
    "supplies_amount",
    "other_amount",
    "active_non_cancel_tx_count",
    "cancelled_tx_count",
    "diagnosis_reason",
    "manual_action",
  ];

  const lines: string[] = [header.map(q).join(",")];

  const enriched = rows.map((r) => {
    const tx = txById.get(r.id);
    const importAmount = Number(tx?.import_amount ?? 0);
    const medicineAmount = Number(tx?.medicine_amount ?? 0);
    const suppliesAmount = Number(tx?.supplies_amount ?? 0);
    const otherAmount = Number(tx?.other_amount ?? 0);
    const manualAmount = medicineAmount + suppliesAmount + otherAmount;

    const d = diagnosis({
      totalBalance: Number(r.total_balance),
      debt: Number(r.debt_amount),
      status: r.status,
      completedVia: r.completed_via,
      importAmount,
      manualAmount,
    });

    lines.push([
      r.card_number,
      r.name,
      r.status,
      r.completed_via ?? "",
      Number(r.total_balance).toFixed(2),
      Number(r.spent_non_cancel).toFixed(2),
      Number(r.debt_amount).toFixed(2),
      importAmount.toFixed(2),
      medicineAmount.toFixed(2),
      suppliesAmount.toFixed(2),
      otherAmount.toFixed(2),
      Number(tx?.active_non_cancel_count ?? 0),
      Number(tx?.cancelled_count ?? 0),
      d.reason,
      d.action,
    ].map(q).join(","));

    return {
      ...r,
      txBreakdown: {
        importAmount,
        medicineAmount,
        suppliesAmount,
        otherAmount,
        activeNonCancelCount: Number(tx?.active_non_cancel_count ?? 0),
        cancelledCount: Number(tx?.cancelled_count ?? 0),
      },
      diagnosisReason: d.reason,
      manualAction: d.action,
    };
  });

  const csvPath = path.join(reportsDir, `overdrawn-official-review-${stamp}.csv`);
  const jsonPath = path.join(reportsDir, `overdrawn-official-review-${stamp}.json`);

  fs.writeFileSync(csvPath, `\uFEFF${lines.join("\n")}`, "utf8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        totalCases: enriched.length,
        summary: {
          totalDebt: Number(enriched.reduce((s, x) => s + Number(x.debt_amount), 0).toFixed(2)),
          zeroTotalBalanceCount: enriched.filter((x) => Number(x.total_balance) <= 0).length,
          activeStatusCount: enriched.filter((x) => x.status === "ACTIVE").length,
          exceededBalanceTaggedCount: enriched.filter((x) => x.completed_via === "EXCEEDED_BALANCE").length,
        },
        cases: enriched,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(JSON.stringify({ totalCases: enriched.length, csvPath, jsonPath }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
