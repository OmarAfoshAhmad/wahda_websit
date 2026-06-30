const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const DEFAULT_SOURCE = "C:/Users/Omar/Desktop/شركة وعد/دفعات مجمعة.xlsx";
const DEFAULT_OUTPUT = path.resolve(process.cwd(), "exports", "دفعات_مجمعة_ترقيم_مقترح_من_نفس_الملف.xlsx");

const OUTPUT_COL_TITLE = "الترقيم_المقترح_من_نفس_الملف";
const STATE_COL_TITLE = "حالة_الاقتراح";

const HEADER_KEYS = {
  name: ["الاسم", "الأسم", "اسم", "اسم المستفيد", "المستفيد", "beneficiary", "name", "beneficiary_name"],
  relation: ["المستفيد", "صلة القرابة", "القرابة", "relationship", "relation", "status"],
  birth: ["تاريخ الميلاد", "تاريخ الملاد", "الميلاد", "المواليد", "birth", "dob", "birth_date"],
  emp: ["رقم الوظيفي", "الرقم الوظيفي", "لرقم الوظيفي", "رقم وظيفي", "employee", "emp", "employee_number", "empno"],
  familyMarker: ["ع.م", "ع,م", "ر.م", "رم", "fm", "family", "family no", "family index"],
  card: [
    "رقم البطاقة",
    "رقم_البطاقة",
    "الباركود",
    "barcode",
    "card",
    "card number",
    "card_number",
    "insurance profile",
    "insurance_profile",
    "insuranceprofile",
    "ترقيم المستفيد",
    "البطاقة",
  ],
};

function toCellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (Array.isArray(value.richText)) return value.richText.map((x) => String(x?.text ?? "")).join("").trim();
    if (value.result != null) return toCellText(value.result);
  }
  return String(value).trim();
}

function normalizeHeader(value) {
  return toCellText(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s._,]/gu, "")
    .trim();
}

function normalizeText(value) {
  return toCellText(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .trim();
}

function onlyDigits(value) {
  const digits = toCellText(value).replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

function parseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const s = toCellText(value);
  if (!s) return "";
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmy) {
    let year = dmy[3];
    if (year.length === 2) year = Number(year) > 30 ? `19${year}` : `20${year}`;
    return `${year}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  }
  return "";
}

function parseCard(value) {
  const raw = toCellText(value).toUpperCase().replace(/[\s\-_]+/g, "");
  if (!raw) return null;
  const m = raw.match(/^WAB20250*([0-9]+)([A-Z][0-9]*)?$/i);
  if (!m) return null;
  return {
    full: `WAB2025${(m[1].replace(/^0+/, "") || "0")}${(m[2] || "").toUpperCase()}`,
  };
}

function isEmployeeRelation(value) {
  const r = normalizeText(value);
  return (
    r === "موظف" ||
    r === "الموظف" ||
    r === "موظفه" ||
    r === "الموظفه" ||
    r === "ربالاسره" ||
    r === "صاحبالبطاقه" ||
    r === "صاحبالبطاقة"
  );
}

function relationCode(value) {
  const r = normalizeText(value);
  if (!r) return "";
  if (isEmployeeRelation(r)) return "";
  if (r.includes("زوج")) return "W";
  if (r === "اب" || r === "الاب" || r === "والد") return "F";
  if (r === "ام" || r === "الام" || r === "والدة" || r === "والده") return "M";
  if (r.includes("ابنة") || r.includes("ابنه") || r.includes("بنت")) return "D";
  if (r.includes("ابن")) return "S";
  if (r.includes("اخ")) return "B";
  return "";
}

function findColIndex(headers, keys) {
  const normalized = headers.map((h) => normalizeHeader(h));
  const target = keys.map((k) => normalizeHeader(k));
  for (let i = 0; i < normalized.length; i += 1) {
    const h = normalized[i];
    if (!h) continue;
    if (target.some((t) => h === t || h.includes(t))) return i + 1;
  }
  return 0;
}

function chooseCardCol(headers) {
  const normalized = headers.map((h) => normalizeHeader(h));
  const candidates = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const h = normalized[i];
    if (!h) continue;
    const hit = HEADER_KEYS.card.some((k) => {
      const nk = normalizeHeader(k);
      return h === nk || h.includes(nk);
    });
    if (hit) candidates.push(i + 1);
  }
  return candidates[0] || 0;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    source: DEFAULT_SOURCE,
    output: DEFAULT_OUTPUT,
    inplace: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--source") opts.source = args[++i] || opts.source;
    else if (a === "--output") opts.output = args[++i] || opts.output;
    else if (a === "--inplace") opts.inplace = true;
  }
  return opts;
}

function pickHeaderRow(sheet) {
  // Try first 5 rows and choose the one with strongest header hits.
  let bestRow = 1;
  let bestScore = -1;
  for (let r = 1; r <= Math.min(5, sheet.rowCount); r += 1) {
    const row = sheet.getRow(r);
    const headers = [];
    for (let c = 1; c <= Math.max(row.cellCount, 20); c += 1) {
      headers.push(toCellText(row.getCell(c).value));
    }
    const score =
      Number(Boolean(findColIndex(headers, HEADER_KEYS.name))) * 5 +
      Number(Boolean(findColIndex(headers, HEADER_KEYS.emp))) * 4 +
      Number(Boolean(findColIndex(headers, HEADER_KEYS.relation))) * 3 +
      Number(Boolean(findColIndex(headers, HEADER_KEYS.birth))) * 2 +
      Number(Boolean(findColIndex(headers, HEADER_KEYS.familyMarker))) * 1;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

async function main() {
  const opts = parseArgs();
  const sourcePath = path.resolve(opts.source);
  if (!fs.existsSync(sourcePath)) throw new Error(`ملف غير موجود: ${sourcePath}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);

  let rowsScanned = 0;
  let suggestions = 0;
  let familiesAllUnnumbered = 0;

  for (const sheet of wb.worksheets) {
    const headerRowNumber = pickHeaderRow(sheet);
    const headerRow = sheet.getRow(headerRowNumber);
    const headers = [];
    for (let c = 1; c <= Math.max(headerRow.cellCount, 25); c += 1) {
      headers.push(toCellText(headerRow.getCell(c).value));
    }

    const nameCol = findColIndex(headers, HEADER_KEYS.name);
    const relationCol = findColIndex(headers, HEADER_KEYS.relation);
    const birthCol = findColIndex(headers, HEADER_KEYS.birth);
    const empCol = findColIndex(headers, HEADER_KEYS.emp);
    const markerCol = findColIndex(headers, HEADER_KEYS.familyMarker);
    const cardCol = chooseCardCol(headers);

    if (!nameCol || !empCol) {
      continue;
    }

    const outputCol = sheet.columnCount + 1;
    const stateCol = sheet.columnCount + 2;
    sheet.getCell(headerRowNumber, outputCol).value = OUTPUT_COL_TITLE;
    sheet.getCell(headerRowNumber, stateCol).value = STATE_COL_TITLE;

    const families = [];
    let currentFamily = null;
    let familySeq = 0;

    for (let r = headerRowNumber + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const name = toCellText(row.getCell(nameCol).value);
      if (!name) continue;

      const marker = markerCol ? toCellText(row.getCell(markerCol).value) : "";
      const emp = onlyDigits(row.getCell(empCol).value);
      const relation = relationCol ? toCellText(row.getCell(relationCol).value) : "";
      const birth = birthCol ? parseDate(row.getCell(birthCol).value) : "";
      const currentCard = cardCol ? parseCard(row.getCell(cardCol).value) : null;

      const startNewByMarker = marker !== "";
      const startNewByEmp = emp !== "" && (!currentFamily || currentFamily.emp !== emp);

      if (!currentFamily || startNewByMarker || startNewByEmp) {
        familySeq += 1;
        currentFamily = {
          id: `FAM-${familySeq}`,
          emp: emp || "",
          members: [],
        };
        families.push(currentFamily);
      }

      if (!currentFamily.emp && emp) currentFamily.emp = emp;

      currentFamily.members.push({
        rowNumber: r,
        name,
        relation,
        relationCode: relationCode(relation),
        birth,
        emp,
        currentCard,
      });
      rowsScanned += 1;
    }

    for (const family of families) {
      const baseDigits = family.emp;
      if (!baseDigits) {
        for (const m of family.members) {
          if (m.currentCard) continue;
          sheet.getCell(m.rowNumber, stateCol).value = "عائلة كاملة غير مرقمة";
        }
        familiesAllUnnumbered += 1;
        continue;
      }

      const used = new Set();
      for (const m of family.members) {
        if (m.currentCard?.full) used.add(m.currentCard.full);
      }

      const byCode = new Map();
      for (const m of family.members) {
        const code = m.relationCode || (m.emp ? "" : "__UNKNOWN__");
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(m);
      }

      for (const members of byCode.values()) {
        members.sort((a, b) => {
          const da = a.birth || "9999-12-31";
          const db = b.birth || "9999-12-31";
          if (da < db) return -1;
          if (da > db) return 1;
          return a.rowNumber - b.rowNumber;
        });
      }

      // MAIN holder
      const mains = byCode.get("") || [];
      if (mains.length > 0) {
        const main = mains[0];
        if (!main.currentCard) {
          const candidate = `WAB2025${baseDigits}`;
          if (!used.has(candidate)) {
            sheet.getCell(main.rowNumber, outputCol).value = candidate;
            sheet.getCell(main.rowNumber, stateCol).value = "مقترح رئيسي من رقم الموظف";
            used.add(candidate);
            suggestions += 1;
          } else {
            sheet.getCell(main.rowNumber, stateCol).value = "الرئيسي مستخدم مسبقاً";
          }
        }
      }

      const relationCodes = ["F", "M", "W", "S", "D", "B"];
      for (const code of relationCodes) {
        const members = byCode.get(code) || [];
        if (members.length === 0) continue;
        let idx = 1;
        for (const m of members) {
          if (m.currentCard) continue;
          let candidate = `WAB2025${baseDigits}${code}${idx}`;
          while (used.has(candidate)) {
            idx += 1;
            candidate = `WAB2025${baseDigits}${code}${idx}`;
          }
          sheet.getCell(m.rowNumber, outputCol).value = candidate;
          sheet.getCell(m.rowNumber, stateCol).value = "مقترح من أفراد العائلة داخل الملف";
          used.add(candidate);
          idx += 1;
          suggestions += 1;
        }
      }

      const unknowns = byCode.get("__UNKNOWN__") || [];
      for (const m of unknowns) {
        if (m.currentCard) continue;
        if (!toCellText(sheet.getCell(m.rowNumber, stateCol).value)) {
          sheet.getCell(m.rowNumber, stateCol).value = "بدون صلة واضحة";
        }
      }
    }

    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: stateCol },
    };
    sheet.getColumn(outputCol).width = 28;
    sheet.getColumn(stateCol).width = 30;
    console.log(`[sheet] ${sheet.name} | families=${families.length}`);
  }

  if (opts.inplace) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${sourcePath}.bak-${stamp}.xlsx`;
    fs.copyFileSync(sourcePath, backupPath);
    await wb.xlsx.writeFile(sourcePath);
    console.log(`[backup] ${backupPath}`);
    console.log(`[saved] ${sourcePath}`);
  } else {
    const outputPath = path.resolve(opts.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await wb.xlsx.writeFile(outputPath);
    console.log(`[saved] ${outputPath}`);
  }

  console.log(`[summary] rows_scanned=${rowsScanned} | suggestions=${suggestions} | families_all_unnumbered=${familiesAllUnnumbered}`);
}

main().catch((error) => {
  console.error("[error]", error?.message || error);
  process.exitCode = 1;
});
