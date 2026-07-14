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
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;
  const digits = m[1].replace(/^0+/, "") || "0";
  return `WAB2025${digits}${m[2] || ""}`;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function asNum(v) {
  return Number(v || 0);
}

async function main() {
  loadDatabaseUrl();
  const prisma = new PrismaClient();

  try {
    const workbook = new ExcelJS.Workbook();
    const anomalies = [];

    const beneficiaries = await prisma.beneficiary.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        card_number: true,
        name: true,
        birth_date: true,
        status: true,
        total_balance: true,
        remaining_balance: true,
        completed_via: true,
        created_at: true,
      },
      orderBy: { card_number: "asc" },
    });

    const driftRows = await prisma.$queryRaw`
      SELECT
        b.id,
        b.card_number,
        b.name,
        b.status,
        b.total_balance::float8 AS total_balance,
        b.remaining_balance::float8 AS stored_remaining,
        (b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0)) AS raw_computed_remaining,
        GREATEST(0, b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0)) AS computed_remaining,
        GREATEST(0, -(b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) AS debt_amount,
        ABS(b.remaining_balance::float8 - GREATEST(0, b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) AS drift
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t
        ON t.beneficiary_id = b.id
        AND t.is_cancelled = false
        AND t.type != 'CANCELLATION'
      WHERE b.deleted_at IS NULL
      GROUP BY b.id
      HAVING
        ABS(b.remaining_balance::float8 - GREATEST(0, b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) > 0.01
        OR GREATEST(0, -(b.total_balance::float8 - COALESCE(SUM(t.amount)::float8, 0))) > 0.01
      ORDER BY drift DESC
    `;

    for (const r of driftRows) {
      const debtAmount = asNum(r.debt_amount);
      const driftAmount = asNum(r.drift);
      const isPureDebt = debtAmount > 0.01 && driftAmount <= 0.01;

      anomalies.push({
        category: isPureDebt ? "OVERDRAWN_DEBT" : "DRIFT_BALANCE",
        severity: isPureDebt
          ? (debtAmount >= 100 ? "HIGH" : "MEDIUM")
          : (driftAmount >= 100 ? "HIGH" : "MEDIUM"),
        beneficiary_id: r.id,
        card_number: r.card_number,
        name: r.name,
        status: r.status,
        total_balance: asNum(r.total_balance),
        remaining_balance: asNum(r.stored_remaining),
        computed_remaining: asNum(r.computed_remaining),
        drift_amount: driftAmount,
        reason: isPureDebt
          ? `الصرف الفعلي تجاوز الإجمالي بمقدار ${debtAmount.toFixed(2)} (دين متراكم)، بينما الرصيد المخزن مضبوط على 0`
          : `الرصيد المخزن لا يطابق الرصيد المحسوب (الفعّال) من الحركات (فرق = ${driftAmount.toFixed(2)})`,
        review_action: isPureDebt
          ? "مراجعة سبب التجاوز (استيراد/خصومات) ثم إجراء تسوية دين أو تصحيح الحركات"
          : "مراجعة حركات المستفيد وإعادة احتساب الرصيد",
        details: isPureDebt
          ? `raw_computed_remaining=${asNum(r.raw_computed_remaining).toFixed(2)} | debt_amount=${debtAmount.toFixed(2)} | الاحتساب يستثني CANCELLATION والملغاة`
          : "الاحتساب يعتمد على الحركات غير الملغاة وغير CANCELLATION",
      });
    }

    const multiImport = await prisma.$queryRaw`
      SELECT t.beneficiary_id, b.card_number, b.name, COUNT(*)::int AS import_count, SUM(t.amount)::float8 AS import_sum, b.total_balance::float8 AS total_balance
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.type = 'IMPORT' AND t.is_cancelled = false AND b.deleted_at IS NULL
      GROUP BY t.beneficiary_id, b.card_number, b.name, b.total_balance
      HAVING COUNT(*) > 1
      ORDER BY import_count DESC
    `;

    for (const r of multiImport) {
      anomalies.push({
        category: "MULTI_IMPORT",
        severity: "MEDIUM",
        beneficiary_id: r.beneficiary_id,
        card_number: r.card_number,
        name: r.name,
        status: "",
        total_balance: asNum(r.total_balance),
        remaining_balance: "",
        computed_remaining: "",
        drift_amount: "",
        reason: `المستفيد لديه أكثر من حركة IMPORT نشطة (العدد = ${r.import_count})`,
        review_action: "تحقق من تكرار الاستيراد واحتفظ بالحركة الصحيحة فقط",
        details: `مجموع IMPORT النشط = ${asNum(r.import_sum).toFixed(2)}`,
      });
    }

    const byCanonical = new Map();
    const byName = new Map();

    for (const b of beneficiaries) {
      const canon = canonicalCard(b.card_number);
      const nName = normalizeName(b.name);

      if (!byCanonical.has(canon)) byCanonical.set(canon, []);
      byCanonical.get(canon).push(b);

      if (nName) {
        if (!byName.has(nName)) byName.set(nName, []);
        byName.get(nName).push(b);
      }

      const rawCard = String(b.card_number || "").trim();
      if (!/^WAB2025\d+[A-Z0-9]*$/i.test(rawCard)) {
        anomalies.push({
          category: "INVALID_CARD_FORMAT",
          severity: "LOW",
          beneficiary_id: b.id,
          card_number: b.card_number,
          name: b.name,
          status: b.status,
          total_balance: asNum(b.total_balance),
          remaining_balance: asNum(b.remaining_balance),
          computed_remaining: "",
          drift_amount: "",
          reason: "تنسيق رقم البطاقة غير مطابق للنمط المتوقع",
          review_action: "مراجعة البطاقة وتصحيح التنسيق إن كانت بيانات قديمة أو مدخلة يدويا",
          details: "النمط المتوقع: WAB2025 + أرقام + لاحقة اختيارية",
        });
      }

      if (b.status === "SUSPENDED" && asNum(b.remaining_balance) > 0) {
        anomalies.push({
          category: "SUSPENDED_WITH_BALANCE",
          severity: "LOW",
          beneficiary_id: b.id,
          card_number: b.card_number,
          name: b.name,
          status: b.status,
          total_balance: asNum(b.total_balance),
          remaining_balance: asNum(b.remaining_balance),
          computed_remaining: "",
          drift_amount: "",
          reason: "الحالة موقوفة لكن يوجد رصيد متبقٍ موجب",
          review_action: "مراجعة سبب الإيقاف: إداري أم بسبب استنفاد الرصيد",
          details: `completed_via=${b.completed_via || ""}`,
        });
      }

      if (asNum(b.remaining_balance) < 0 || asNum(b.remaining_balance) > asNum(b.total_balance)) {
        anomalies.push({
          category: "BALANCE_RANGE_ANOMALY",
          severity: "HIGH",
          beneficiary_id: b.id,
          card_number: b.card_number,
          name: b.name,
          status: b.status,
          total_balance: asNum(b.total_balance),
          remaining_balance: asNum(b.remaining_balance),
          computed_remaining: "",
          drift_amount: "",
          reason: "الرصيد المتبقي خارج المجال المنطقي (أقل من 0 أو أكبر من الإجمالي)",
          review_action: "فحص حركات المستفيد وتحديث الرصيد",
          details: "",
        });
      }
    }

    for (const [canon, group] of byCanonical.entries()) {
      if (group.length <= 1) continue;
      const cards = [...new Set(group.map((x) => String(x.card_number).trim().toUpperCase()))];
      if (cards.length <= 1) continue;

      for (const b of group) {
        anomalies.push({
          category: "CANONICAL_CARD_DUPLICATE",
          severity: "MEDIUM",
          beneficiary_id: b.id,
          card_number: b.card_number,
          name: b.name,
          status: b.status,
          total_balance: asNum(b.total_balance),
          remaining_balance: asNum(b.remaining_balance),
          computed_remaining: "",
          drift_amount: "",
          reason: `نفس البطاقة منطقيا بعد إزالة الأصفار (canonical=${canon})`,
          review_action: "تحديد السجل الصحيح ثم دمج/تعطيل السجلات المكررة",
          details: `بطاقات المجموعة: ${cards.join(" | ")}`,
        });
      }
    }

    for (const [nameKey, group] of byName.entries()) {
      const cards = [...new Set(group.map((x) => String(x.card_number).trim().toUpperCase()))];
      if (cards.length <= 1) continue;

      for (const b of group) {
        anomalies.push({
          category: "SAME_NAME_MULTIPLE_CARDS",
          severity: "LOW",
          beneficiary_id: b.id,
          card_number: b.card_number,
          name: b.name,
          status: b.status,
          total_balance: asNum(b.total_balance),
          remaining_balance: asNum(b.remaining_balance),
          computed_remaining: "",
          drift_amount: "",
          reason: "نفس الاسم (بعد التطبيع) مرتبط بأكثر من بطاقة",
          review_action: "التحقق من تاريخ الميلاد/الهوية للتأكد هل هي حالات متكررة أم أفراد مختلفون",
          details: `normalized_name=${nameKey} | cards=${cards.join(" | ")}`,
        });
      }
    }

    const summaryByCategory = new Map();
    for (const row of anomalies) {
      summaryByCategory.set(row.category, (summaryByCategory.get(row.category) || 0) + 1);
    }

    const wsSummary = workbook.addWorksheet("ملخص");
    wsSummary.columns = [
      { header: "المؤشر", key: "metric", width: 45 },
      { header: "القيمة", key: "value", width: 18 },
    ];
    wsSummary.getRow(1).font = { bold: true };
    wsSummary.addRow({ metric: "إجمالي المستفيدين النشطين", value: beneficiaries.length });
    wsSummary.addRow({ metric: "إجمالي الحالات الشاذة (صفوف التقرير)", value: anomalies.length });
    wsSummary.addRow({ metric: "تاريخ التقرير", value: new Date().toISOString() });

    for (const [k, v] of [...summaryByCategory.entries()].sort((a, b) => b[1] - a[1])) {
      wsSummary.addRow({ metric: `عدد حالات ${k}`, value: v });
    }

    const ws = workbook.addWorksheet("تفاصيل التشوهات");
    ws.columns = [
      { header: "category", key: "category", width: 28 },
      { header: "severity", key: "severity", width: 12 },
      { header: "beneficiary_id", key: "beneficiary_id", width: 30 },
      { header: "card_number", key: "card_number", width: 22 },
      { header: "name", key: "name", width: 32 },
      { header: "status", key: "status", width: 14 },
      { header: "total_balance", key: "total_balance", width: 14 },
      { header: "remaining_balance", key: "remaining_balance", width: 16 },
      { header: "computed_remaining", key: "computed_remaining", width: 17 },
      { header: "drift_amount", key: "drift_amount", width: 12 },
      { header: "reason", key: "reason", width: 52 },
      { header: "review_action", key: "review_action", width: 46 },
      { header: "details", key: "details", width: 70 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const row of anomalies) {
      ws.addRow(row);
    }

    const outDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
    const outPath = path.join(outDir, `db-anomalies-review-${stamp}.xlsx`);

    await workbook.xlsx.writeFile(outPath);

    console.log(`REPORT_CREATED=${outPath}`);
    console.log(`ANOMALIES_TOTAL=${anomalies.length}`);
    console.log(`BENEFICIARIES_TOTAL=${beneficiaries.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Export failed:", err.message || err);
  process.exit(1);
});
