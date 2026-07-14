import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { getOverdrawnDebtCases } from "@/lib/overdrawn-debt-settlement";

const prisma = new PrismaClient();

type TxAgg = {
  beneficiary_id: string;
  import_amount: number;
  medicine_amount: number;
  supplies_amount: number;
  other_amount: number;
  active_non_cancel_amount: number;
  active_non_cancel_count: number;
  cancelled_count: number;
};

type BenMeta = {
  id: string;
  status: string;
  completed_via: string | null;
};

function q(v: unknown): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes("\"")) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

function reasonAndAction(input: {
  debt: number;
  familyAvailable: number;
  residual: number;
  debtorStatus: string;
  importAmount: number;
  manualAmount: number;
}) {
  const reasons: string[] = [];

  if (input.familyAvailable <= 0) {
    reasons.push("لا يوجد رصيد متاح لدى أفراد الأسرة النشطين لتغطية الدين");
  } else if (input.residual > 0) {
    reasons.push("الرصيد العائلي المتاح غير كافٍ لتغطية كامل الدين");
  } else {
    reasons.push("الحالة قابلة للتسوية بالكامل من رصيد الأسرة");
  }

  if (input.debtorStatus === "ACTIVE") {
    reasons.push("المستفيد ما زال نشطا رغم تجاوز الصرف");
  }

  if (input.importAmount > input.debt * 0.6) {
    reasons.push("الاستيراد يشكل الجزء الأكبر من إجمالي الصرف");
  }

  if (input.manualAmount > input.debt * 0.6) {
    reasons.push("الخصومات اليدوية تشكل الجزء الأكبر من إجمالي الصرف");
  }

  let action = "مراجعة كشف حركة المستفيد وتوثيق سبب التجاوز";

  if (input.familyAvailable <= 0) {
    action = "تجميد الحساب مؤقتا + قيد تسوية يدوي خارج الأسرة (إداري/مالي)";
  } else if (input.residual > 0) {
    action = "توزيع يدوي من الأسرة حسب المتاح ثم اعتماد معالجة المتبقي يدويا";
  } else {
    action = "تشغيل تسوية عائلية لهذه الحالة فقط ثم إعادة فحص الرصيد";
  }

  return { reasons: reasons.join(" | "), action };
}

async function main() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const reportsDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const cases = await getOverdrawnDebtCases();
  if (cases.length === 0) {
    console.log(JSON.stringify({ message: "No overdrawn cases found.", count: 0 }, null, 2));
    return;
  }

  const debtorIds = cases.map((c) => c.debtorId);

  const [txAggRows, benRows] = await Promise.all([
    prisma.$queryRaw<TxAgg[]>`
      SELECT
        t.beneficiary_id,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'IMPORT' THEN t.amount ELSE 0 END), 0)::float8 AS import_amount,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'MEDICINE' THEN t.amount ELSE 0 END), 0)::float8 AS medicine_amount,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'SUPPLIES' THEN t.amount ELSE 0 END), 0)::float8 AS supplies_amount,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type NOT IN ('IMPORT', 'MEDICINE', 'SUPPLIES', 'CANCELLATION') THEN t.amount ELSE 0 END), 0)::float8 AS other_amount,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)::float8 AS active_non_cancel_amount,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN 1 ELSE 0 END), 0)::int AS active_non_cancel_count,
        COALESCE(SUM(CASE WHEN t.is_cancelled = true THEN 1 ELSE 0 END), 0)::int AS cancelled_count
      FROM "Transaction" t
      WHERE t.beneficiary_id IN (${Prisma.join(debtorIds)})
      GROUP BY t.beneficiary_id
    `,
    prisma.beneficiary.findMany({
      where: { id: { in: debtorIds } },
      select: { id: true, status: true, completed_via: true },
    }),
  ]);

  const txById = new Map(txAggRows.map((r) => [r.beneficiary_id, r]));
  const benById = new Map<string, BenMeta>(benRows.map((b) => [b.id, { id: b.id, status: b.status, completed_via: b.completed_via }]));

  const header = [
    "debtor_card",
    "debtor_name",
    "debtor_status",
    "completed_via",
    "debt_amount",
    "debtor_total_balance",
    "debtor_spent",
    "family_base_card",
    "family_members_count",
    "family_available_total",
    "planned_distributed",
    "residual_after_distribution",
    "import_amount",
    "medicine_amount",
    "supplies_amount",
    "other_amount",
    "active_non_cancel_tx_count",
    "cancelled_tx_count",
    "diagnosis_reason",
    "manual_action",
    "suggested_helpers",
  ];

  const lines: string[] = [header.map(q).join(",")];

  const detailed = cases.map((c) => {
    const tx = txById.get(c.debtorId);
    const ben = benById.get(c.debtorId);

    const importAmount = Number(tx?.import_amount ?? 0);
    const manualAmount = Number((tx?.medicine_amount ?? 0) + (tx?.supplies_amount ?? 0) + (tx?.other_amount ?? 0));

    const diag = reasonAndAction({
      debt: c.debtorDebtAmount,
      familyAvailable: c.familyAvailableTotal,
      residual: c.residualDebtAfterDistribution,
      debtorStatus: ben?.status ?? "UNKNOWN",
      importAmount,
      manualAmount,
    });

    const helpers = c.shares
      .map((s) => `${s.memberCard}:${s.deductedAmount}`)
      .join("; ");

    const row = [
      c.debtorCard,
      c.debtorName,
      ben?.status ?? "UNKNOWN",
      ben?.completed_via ?? "",
      c.debtorDebtAmount,
      c.debtorTotalBalance,
      c.debtorSpent,
      c.familyBaseCard,
      c.familyMembersCount,
      c.familyAvailableTotal,
      c.plannedDistributed,
      c.residualDebtAfterDistribution,
      importAmount,
      Number(tx?.medicine_amount ?? 0),
      Number(tx?.supplies_amount ?? 0),
      Number(tx?.other_amount ?? 0),
      Number(tx?.active_non_cancel_count ?? 0),
      Number(tx?.cancelled_count ?? 0),
      diag.reasons,
      diag.action,
      helpers,
    ];

    lines.push(row.map(q).join(","));

    return {
      ...c,
      debtorStatus: ben?.status ?? "UNKNOWN",
      completedVia: ben?.completed_via ?? null,
      txBreakdown: {
        importAmount,
        medicineAmount: Number(tx?.medicine_amount ?? 0),
        suppliesAmount: Number(tx?.supplies_amount ?? 0),
        otherAmount: Number(tx?.other_amount ?? 0),
        activeNonCancelAmount: Number(tx?.active_non_cancel_amount ?? 0),
        activeNonCancelCount: Number(tx?.active_non_cancel_count ?? 0),
        cancelledCount: Number(tx?.cancelled_count ?? 0),
      },
      diagnosisReason: diag.reasons,
      manualAction: diag.action,
      suggestedHelpers: helpers,
    };
  });

  const csvPath = path.join(reportsDir, `overdrawn-manual-review-${stamp}.csv`);
  const jsonPath = path.join(reportsDir, `overdrawn-manual-review-${stamp}.json`);

  fs.writeFileSync(csvPath, `\uFEFF${lines.join("\n")}`, "utf8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        totalCases: detailed.length,
        summary: {
          totalDebt: Number(detailed.reduce((s, x) => s + x.debtorDebtAmount, 0).toFixed(2)),
          totalPlannedDistributed: Number(detailed.reduce((s, x) => s + x.plannedDistributed, 0).toFixed(2)),
          totalResidual: Number(detailed.reduce((s, x) => s + x.residualDebtAfterDistribution, 0).toFixed(2)),
          noFamilySupportCount: detailed.filter((x) => x.familyAvailableTotal <= 0).length,
          partialSupportCount: detailed.filter((x) => x.familyAvailableTotal > 0 && x.residualDebtAfterDistribution > 0).length,
          fullyCoverableCount: detailed.filter((x) => x.residualDebtAfterDistribution <= 0).length,
        },
        cases: detailed,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        totalCases: detailed.length,
        csvPath,
        jsonPath,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
