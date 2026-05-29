const fs = require("node:fs/promises");
const path = require("node:path");
const ExcelJS = require("exceljs");

const SOURCE_DIR = process.argv[2] || "C:/Users/Omar/Desktop/شركة وعد/بنغازي";
const TARGET_FILES = [
  "BEN_13.xlsx",
  "BEN_14.xlsx",
  "BEN_15_16.xlsx",
  "BEN_17.xlsx",
  "BEN_18.xlsx",
  "BEN_19.xlsx",
  "BEN_20.xlsx",
];

const CARD_HEADER_REGEX = /(insurance\s*profile|رقم\s*البطاقة|الباركود|card_number|card\s*number|\bbarcode\b)/i;
const EMP_HEADER_REGEX = /(EMPNO|emp\s*no|employee|الرقم\s*الوظيفي|رقم\s*الوظيفي|رقم\s*الموظف|رقم الوظيفي)/i;
const EMP_MAIN_HEADER_REGEX = /(EMP_No_Main|emp.*main|main.*emp|الرقم\s*الرئيسي|رقم\s*الاسرة|رقم\s*رب\s*الاسرة)/i;
const REL_HEADER_STRONG_REGEX = /(status|صلة|القرابة|relationship|relation|الصلة)/i;
const REL_HEADER_WEAK_REGEX = /^المستفيد$/i;

const EMPLOYEE_TOKENS = new Set([
  "موظف",
  "موظفه",
  "موظفمتقاعد",
  "متقاعد",
  "ربالاسره",
  "صاحبالبطاقه",
  "صاحبالبطاقة",
]);
const FATHER_TOKENS = new Set(["اب", "الاب", "ابو", "والد"]);
const MOTHER_TOKENS = new Set(["ام", "الام", "والده", "والدة"]);

function toCellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (Array.isArray(value.richText)) return value.richText.map((x) => String(x?.text ?? "")).join("").trim();
    if (value.result != null) return toCellText(value.result);
  }
  return String(value).trim();
}

function normalizeText(v) {
  return toCellText(v)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s_\-]+/g, "");
}

function onlyDigits(v) {
  return toCellText(v).replace(/\D+/g, "");
}

function parseCard(cardValue) {
  const raw = toCellText(cardValue).toUpperCase();
  const card = raw.replace(/[\s\-_]+/g, "");
  const match = card.match(/^WAB2025(\d+)([A-Z]\d*)?$/i);
  if (!match) return null;
  return {
    full: `WAB2025${match[1]}${match[2] ?? ""}`,
    baseDigits: match[1],
    suffix: match[2] ?? "",
  };
}

function buildCard(baseDigits, suffix = "") {
  return `WAB2025${baseDigits}${suffix}`;
}

function isEmployee(rel) {
  const n = normalizeText(rel);
  if (!n) return false;
  if (EMPLOYEE_TOKENS.has(n)) return true;
  return n.includes("موظف") || n.includes("ربالاسره");
}

function isFather(rel) {
  return FATHER_TOKENS.has(normalizeText(rel));
}

function isMother(rel) {
  return MOTHER_TOKENS.has(normalizeText(rel));
}

function choosePreferredCardColumn(cardCols) {
  const exactCard = cardCols.find((c) => /رقم\s*البطاقة|card_number|insurance profile$/i.test(c.header));
  if (exactCard) return exactCard.col;
  const insuranceDash = cardCols.find((c) => /insurance profile-/i.test(c.header));
  if (insuranceDash) return insuranceDash.col;
  return cardCols[0].col;
}

function addCount(map, key, value) {
  if (!key || !value) return;
  if (!map.has(key)) map.set(key, new Map());
  const inner = map.get(key);
  inner.set(value, (inner.get(value) ?? 0) + 1);
}

function bestValue(counterMap) {
  let best = "";
  let bestCount = -1;
  for (const [v, c] of counterMap.entries()) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function detectRelationColumn(sheet, headersByCol) {
  let strong = null;
  let weak = null;

  for (const [colStr, header] of Object.entries(headersByCol)) {
    const col = Number(colStr);
    if (REL_HEADER_STRONG_REGEX.test(header)) {
      strong = col;
      break;
    }
    if (REL_HEADER_WEAK_REGEX.test(header)) {
      weak = col;
    }
  }

  const candidate = strong ?? weak;
  if (!candidate) return null;

  let nonEmpty = 0;
  let relationLike = 0;
  const maxRows = Math.min(sheet.rowCount, 220);

  for (let r = 2; r <= maxRows; r += 1) {
    const value = toCellText(sheet.getRow(r).getCell(candidate).value);
    if (!value) continue;
    nonEmpty += 1;
    if (isEmployee(value) || isFather(value) || isMother(value) || normalizeText(value).includes("زوج") || normalizeText(value).includes("ابن")) {
      relationLike += 1;
    }
  }

  if (nonEmpty === 0) return null;
  const score = relationLike / nonEmpty;
  if (strong) return score >= 0.1 ? candidate : null;
  return score >= 0.35 ? candidate : null;
}

function deriveBaseFix(baseDigits, empDigits) {
  if (!empDigits) return baseDigits;
  if (baseDigits.endsWith(`${empDigits}1`)) {
    return baseDigits.slice(0, -1);
  }
  return baseDigits;
}

function toCsv(rows) {
  const header = [
    "file",
    "sheet",
    "row",
    "column",
    "old_value",
    "new_value",
    "reason",
  ];
  const escape = (v) => {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      row.file,
      row.sheet,
      row.row,
      row.column,
      row.oldValue,
      row.newValue,
      row.reason,
    ].map(escape).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function processWorkbook(filePath, outPath, reportRows) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  let fileChanges = 0;

  for (const sheet of wb.worksheets) {
    const headerRow = sheet.getRow(1);
    const headersByCol = {};
    for (let c = 1; c <= headerRow.cellCount; c += 1) {
      const h = toCellText(headerRow.getCell(c).value);
      if (h) headersByCol[c] = h;
    }

    const cardCols = Object.entries(headersByCol)
      .filter(([, h]) => CARD_HEADER_REGEX.test(h))
      .map(([col, header]) => ({ col: Number(col), header }));
    if (cardCols.length === 0) continue;

    const preferredCardCol = choosePreferredCardColumn(cardCols);
    const relationCol = detectRelationColumn(sheet, headersByCol);
    const empCol = Number(
      Object.keys(headersByCol).find((k) => EMP_HEADER_REGEX.test(headersByCol[k]) && !EMP_MAIN_HEADER_REGEX.test(headersByCol[k])) ?? 0,
    ) || null;
    const empMainCol = Number(
      Object.keys(headersByCol).find((k) => EMP_MAIN_HEADER_REGEX.test(headersByCol[k])) ?? 0,
    ) || null;

    const empBaseCounter = new Map();

    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const primaryCard = parseCard(row.getCell(preferredCardCol).value);
      if (!primaryCard) continue;

      const rel = relationCol ? toCellText(row.getCell(relationCol).value) : "";
      if (relationCol && !isEmployee(rel)) continue;
      const emp = onlyDigits(empCol ? row.getCell(empCol).value : "") || onlyDigits(empMainCol ? row.getCell(empMainCol).value : "");
      if (!emp) continue;

      let base = primaryCard.baseDigits;
      if (isEmployee(rel)) {
        base = deriveBaseFix(base, emp);
      }
      addCount(empBaseCounter, emp, base);
    }

    const empBaseMap = new Map();
    for (const [emp, counter] of empBaseCounter.entries()) {
      empBaseMap.set(emp, bestValue(counter));
    }

    let lastFamilyBase = "";
    let lastFamilyEmp = "";

    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const parsedCards = cardCols
        .map(({ col, header }) => ({ col, header, parsed: parseCard(row.getCell(col).value), raw: toCellText(row.getCell(col).value) }))
        .filter((x) => x.parsed);

      if (parsedCards.length === 0) continue;

      const preferredParsed = parsedCards.find((x) => x.col === preferredCardCol) ?? parsedCards[0];
      const rel = relationCol ? toCellText(row.getCell(relationCol).value) : "";
      const relEmp = onlyDigits(empCol ? row.getCell(empCol).value : "");
      const relEmpMain = onlyDigits(empMainCol ? row.getCell(empMainCol).value : "");
      const emp = relEmp || relEmpMain || lastFamilyEmp;

      const employeeRow = relationCol ? isEmployee(rel) : false;
      const fatherRow = relationCol ? isFather(rel) : false;
      const motherRow = relationCol ? isMother(rel) : false;

      let targetBase = preferredParsed.parsed.baseDigits;
      let targetSuffix = preferredParsed.parsed.suffix;
      const reasons = [];

      if (employeeRow) {
        const fixed = deriveBaseFix(targetBase, emp);
        if (fixed !== targetBase) {
          targetBase = fixed;
          reasons.push("fix_employee_plus_one");
        }
        targetSuffix = "";
      }

      if (emp && empBaseMap.has(emp)) {
        const mapped = empBaseMap.get(emp);
        if (mapped && targetBase !== mapped && (employeeRow || fatherRow || motherRow || targetBase === `${mapped}1`)) {
          targetBase = mapped;
          reasons.push("align_family_base");
        }
      }

      if (fatherRow) {
        if (targetSuffix !== "F1") {
          targetSuffix = "F1";
          reasons.push("fix_father_suffix");
        }
      } else if (motherRow) {
        if (targetSuffix !== "M1") {
          targetSuffix = "M1";
          reasons.push("fix_mother_suffix");
        }
      }

      const nextCard = buildCard(targetBase, targetSuffix);

      if (employeeRow || parsedCards.some((x) => x.raw.toUpperCase() !== nextCard.toUpperCase())) {
        for (const card of parsedCards) {
          const oldValue = card.raw;
          if (!oldValue) continue;
          if (oldValue.toUpperCase() === nextCard.toUpperCase()) continue;
          row.getCell(card.col).value = nextCard;
          fileChanges += 1;
          reportRows.push({
            file: path.basename(filePath),
            sheet: sheet.name,
            row: r,
            column: card.header,
            oldValue,
            newValue: nextCard,
            reason: reasons.join("+") || "sync_card_columns",
          });
        }
      }

      if (employeeRow) {
        lastFamilyBase = targetBase;
        lastFamilyEmp = relEmp || relEmpMain || lastFamilyEmp;
      } else if (emp && empBaseMap.has(emp)) {
        lastFamilyBase = empBaseMap.get(emp);
        lastFamilyEmp = emp;
      } else if (!emp && lastFamilyBase && (fatherRow || motherRow || normalizeText(rel).includes("زوج") || normalizeText(rel).includes("ابن"))) {
        // Keep current family context.
      } else if (!relationCol) {
        lastFamilyBase = preferredParsed.parsed.baseDigits;
      }
    }
  }

  await wb.xlsx.writeFile(outPath);
  return fileChanges;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(SOURCE_DIR, `مصحح_دفعات_13_20_${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  const reportRows = [];
  const summary = [];

  for (const fileName of TARGET_FILES) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    try {
      await fs.access(sourcePath);
    } catch {
      summary.push({ file: fileName, status: "missing", changes: 0, output: "" });
      continue;
    }

    const outPath = path.join(outDir, fileName.replace(/\.xlsx$/i, "_corrected.xlsx"));
    const changes = await processWorkbook(sourcePath, outPath, reportRows);
    summary.push({ file: fileName, status: "ok", changes, output: outPath });
  }

  const reportPath = path.join(outDir, "changes_report.csv");
  await fs.writeFile(reportPath, toCsv(reportRows), "utf8");

  const summaryPath = path.join(outDir, "summary.json");
  await fs.writeFile(summaryPath, `${JSON.stringify({ source: SOURCE_DIR, output: outDir, summary }, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ output: outDir, report: reportPath, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
