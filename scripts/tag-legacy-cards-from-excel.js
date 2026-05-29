const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { PrismaClient, Prisma } = require("@prisma/client");

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const DEFAULT_REPORT_DIR = "reports";
const CARD_HEADER_KEYS = [
  "رقم البطاقة",
  "رقم_البطاقة",
  "البطاقة",
  "card",
  "card number",
  "card_number",
  "insurance profile",
];

function toAsciiDigits(value) {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const i1 = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (i1 >= 0) return String(i1);
    const i2 = EASTERN_ARABIC_DIGITS.indexOf(ch);
    if (i2 >= 0) return String(i2);
    return ch;
  });
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeCard(value) {
  return toAsciiDigits(String(value ?? ""))
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, "");
}

function canonicalizeCard(card) {
  const c = normalizeCard(card);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;
  const digits = m[1].replace(/^0+/, "") || "0";
  return `WAB2025${digits}${m[2] || ""}`;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    file: "",
    sheet: "",
    envFile: "",
    apply: false,
    report: "",
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") opts.file = args[++i] ?? "";
    else if (a === "--sheet") opts.sheet = args[++i] ?? "";
    else if (a === "--env") opts.envFile = args[++i] ?? "";
    else if (a === "--report") opts.report = args[++i] ?? "";
    else if (a === "--apply") opts.apply = true;
    else if (a === "--dry-run") opts.apply = false;
  }

  if (!opts.file) {
    throw new Error("يرجى تمرير مسار الملف: --file <path.xlsx>");
  }

  return opts;
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

function ensureDatabaseUrl(envFileArg) {
  if (process.env.DATABASE_URL) return;

  const candidates = [];
  if (envFileArg) {
    candidates.push(path.resolve(process.cwd(), envFileArg));
  }
  candidates.push(path.resolve(process.cwd(), ".env.production"));
  candidates.push(path.resolve(process.cwd(), ".env"));

  for (const c of candidates) {
    if (loadEnvFile(c) && process.env.DATABASE_URL) return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL غير موجود. مرره كمتغير بيئة أو عبر --env <file>.");
  }
}

function pickCardColumn(worksheet) {
  const headerRow = worksheet.getRow(1);
  const headers = [];
  for (let c = 1; c <= headerRow.cellCount; c++) {
    headers.push(normalizeHeader(headerRow.getCell(c).value));
  }

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    if (CARD_HEADER_KEYS.some((k) => h.includes(normalizeHeader(k)))) {
      return i + 1;
    }
  }

  return 1;
}

function defaultReportPath(inputFile) {
  const stamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
  const reportDir = path.resolve(process.cwd(), DEFAULT_REPORT_DIR);
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const base = path.basename(inputFile).replace(/\.(xlsx|xlsm|xls)$/i, "");
  return path.join(reportDir, `${base}-legacy-tag-report-${stamp}.xlsx`);
}

async function writeReport(reportPath, summary, details) {
  const wb = new ExcelJS.Workbook();

  const wsSummary = wb.addWorksheet("ملخص");
  wsSummary.columns = [
    { header: "المؤشر", key: "metric", width: 42 },
    { header: "القيمة", key: "value", width: 22 },
  ];
  wsSummary.addRows([
    { metric: "وضع التنفيذ", value: summary.mode },
    { metric: "الملف", value: summary.inputFile },
    { metric: "الشيت", value: summary.sheet },
    { metric: "إجمالي صفوف الملف", value: summary.totalRows },
    { metric: "بطاقات فريدة صالحة", value: summary.uniqueCards },
    { metric: "مطابقة نشطة في المنظومة", value: summary.matchedRows },
    { metric: "موسومة مسبقاً", value: summary.alreadyLegacy },
    { metric: "تحتاج وسم", value: summary.needsTagBefore },
    { metric: "تم وسمها الآن", value: summary.taggedNow },
    { metric: "غير موجودة بالمنظومة", value: summary.missingRows },
  ]);
  wsSummary.getRow(1).font = { bold: true };

  const wsDetails = wb.addWorksheet("تفاصيل");
  wsDetails.columns = [
    { header: "canonical_card", key: "canonical_card", width: 24 },
    { header: "card_in_system", key: "card_in_system", width: 24 },
    { header: "is_legacy_before", key: "is_legacy_before", width: 16 },
    { header: "status", key: "status", width: 26 },
  ];
  for (const d of details) wsDetails.addRow(d);
  wsDetails.getRow(1).font = { bold: true };

  await wb.xlsx.writeFile(reportPath);
}

async function main() {
  const opts = parseArgs();
  ensureDatabaseUrl(opts.envFile);

  const filePath = path.resolve(process.cwd(), opts.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`الملف غير موجود: ${filePath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  if (workbook.worksheets.length === 0) {
    throw new Error("الملف لا يحتوي أي شيت.");
  }

  const worksheet = opts.sheet
    ? workbook.getWorksheet(opts.sheet)
    : workbook.worksheets[0];

  if (!worksheet) {
    throw new Error(`الشيت غير موجود: ${opts.sheet}`);
  }

  const cardCol = pickCardColumn(worksheet);

  const rawCards = [];
  for (let r = 2; r <= worksheet.rowCount; r++) {
    const v = worksheet.getRow(r).getCell(cardCol).value;
    const card = normalizeCard(v);
    if (!card) continue;
    const canonical = canonicalizeCard(card);
    if (!canonical.startsWith("WAB2025")) continue;
    rawCards.push(canonical);
  }

  const uniqueCanonicals = Array.from(new Set(rawCards));
  if (uniqueCanonicals.length === 0) {
    throw new Error("لم يتم العثور على بطاقات صالحة داخل الملف.");
  }

  const prisma = new PrismaClient();
  try {
    const foundRows = [];
    for (const chunk of chunkArray(uniqueCanonicals, 2000)) {
      const rows = await prisma.$queryRawUnsafe(
        `
        SELECT
          id,
          card_number,
          is_legacy_card,
          REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          AND REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') = ANY($1::text[])
      `,
        chunk
      );
      foundRows.push(...rows);
    }

    const byCanonical = new Map();
    for (const row of foundRows) {
      const c = String(row.canonical_card ?? "");
      if (!c) continue;
      if (!byCanonical.has(c)) byCanonical.set(c, row);
    }

    const details = [];
    let matchedRows = 0;
    let missingRows = 0;
    let alreadyLegacy = 0;
    let needsTagBefore = 0;
    const toUpdateCanonicals = [];

    for (const c of uniqueCanonicals) {
      const row = byCanonical.get(c);
      if (!row) {
        missingRows += 1;
        details.push({
          canonical_card: c,
          card_in_system: "",
          is_legacy_before: "",
          status: "غير_موجود_بالمنظومة",
        });
        continue;
      }

      matchedRows += 1;
      const isLegacy = Boolean(row.is_legacy_card);
      if (isLegacy) {
        alreadyLegacy += 1;
        details.push({
          canonical_card: c,
          card_in_system: String(row.card_number ?? ""),
          is_legacy_before: "true",
          status: "موسوم_مسبقاً",
        });
      } else {
        needsTagBefore += 1;
        toUpdateCanonicals.push(c);
        details.push({
          canonical_card: c,
          card_in_system: String(row.card_number ?? ""),
          is_legacy_before: "false",
          status: opts.apply ? "سيتم_وسمه" : "يحتاج_وسم",
        });
      }
    }

    let taggedNow = 0;
    if (opts.apply && toUpdateCanonicals.length > 0) {
      for (const chunk of chunkArray(toUpdateCanonicals, 2000)) {
        const updated = await prisma.$executeRaw`
          UPDATE "Beneficiary" b
          SET is_legacy_card = true
          WHERE b.deleted_at IS NULL
            AND b.is_legacy_card = false
            AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') IN (${Prisma.join(chunk)})
        `;
        taggedNow += Number(updated ?? 0);
      }

      for (const d of details) {
        if (d.status === "سيتم_وسمه") d.status = "تم_وسمه";
      }
    }

    const summary = {
      mode: opts.apply ? "APPLY" : "DRY_RUN",
      inputFile: filePath,
      sheet: worksheet.name,
      totalRows: Math.max(worksheet.rowCount - 1, 0),
      uniqueCards: uniqueCanonicals.length,
      matchedRows,
      alreadyLegacy,
      needsTagBefore,
      taggedNow,
      missingRows,
    };

    const reportPath = opts.report
      ? path.resolve(process.cwd(), opts.report)
      : defaultReportPath(filePath);

    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    await writeReport(reportPath, summary, details);

    console.log(`MODE=${summary.mode}`);
    console.log(`INPUT_FILE=${summary.inputFile}`);
    console.log(`SHEET=${summary.sheet}`);
    console.log(`TOTAL_ROWS=${summary.totalRows}`);
    console.log(`UNIQUE_CARDS=${summary.uniqueCards}`);
    console.log(`MATCHED_ACTIVE=${summary.matchedRows}`);
    console.log(`ALREADY_LEGACY=${summary.alreadyLegacy}`);
    console.log(`NEEDS_TAG_BEFORE=${summary.needsTagBefore}`);
    console.log(`TAGGED_NOW=${summary.taggedNow}`);
    console.log(`MISSING_IN_SYSTEM=${summary.missingRows}`);
    console.log(`REPORT=${reportPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("TAG_LEGACY_FROM_EXCEL_FAILED:", error?.message || error);
  process.exit(1);
});

