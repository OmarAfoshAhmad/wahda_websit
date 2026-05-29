const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const DEFAULT_SOURCE = "C:/Users/Omar/Desktop/شركة وعد/دفعات مجمعة.xlsx";
const DEFAULT_OUTPUT = path.resolve(process.cwd(), "exports", "دفعات_مجمعة_مع_ترقيم_مقترح.xlsx");

const HEADER_KEYS = {
  name: ["الاسم", "الأسم", "اسم", "اسم المستفيد", "المستفيد", "beneficiary", "name", "beneficiary_name"],
  relation: ["المستفيد", "صلة القرابة", "القرابة", "relationship", "relation", "status"],
  birth: ["تاريخ الميلاد", "تاريخ الملاد", "الميلاد", "المواليد", "birth", "dob", "birth_date"],
  emp: ["رقم الوظيفي", "الرقم الوظيفي", "رقم وظيفي", "employee", "emp", "employee_number", "empno"],
  empMain: ["emp_no_main", "main emp", "main_emp", "رقم الاسرة", "رقم رب الاسرة", "الرقم الرئيسي"],
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

const OUTPUT_COL_TITLE = "الترقيم_المقترح_من_نفس_الملف";
const STATE_COL_TITLE = "حالة_الاقتراح";

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
    .replace(/[^\p{L}\p{N}\s_]/gu, "")
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

function normalizeName(value) {
  return toCellText(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function onlyDigits(value) {
  const digits = toCellText(value).replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

function parseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = toCellText(value);
  if (!s) return "";

  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;

  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmy) {
    let year = dmy[3];
    if (year.length === 2) year = Number(year) > 30 ? `19${year}` : `20${year}`;
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function parseCard(value) {
  const raw = toCellText(value).toUpperCase().replace(/[\s\-_]+/g, "");
  if (!raw) return null;
  const m = raw.match(/^WAB20250*([0-9]+)([A-Z][0-9]*)?$/i);
  if (!m) return null;
  const baseDigits = m[1].replace(/^0+/, "") || "0";
  const suffix = (m[2] || "").toUpperCase();
  return {
    full: `WAB2025${baseDigits}${suffix}`,
    baseDigits,
    suffix,
  };
}

function parseSuffixInfo(suffix) {
  const s = String(suffix || "").toUpperCase();
  if (!s) return { code: "MAIN", index: null };
  const m = s.match(/^([A-Z])([0-9]*)$/);
  if (!m) return { code: "OTHER", index: null };
  const code = m[1];
  const index = m[2] ? Number(m[2]) : null;
  return { code, index: Number.isFinite(index) ? index : null };
}

function relationCode(value) {
  const r = normalizeText(value);
  if (!r) return "";
  if (
    r === "موظف" ||
    r === "الموظف" ||
    r === "موظفه" ||
    r === "الموظفه" ||
    r === "ربالاسره" ||
    r === "صاحبالبطاقه" ||
    r === "صاحبالبطاقة"
  ) {
    return "";
  }
  if (r.includes("زوج") || r.includes("زوجه")) return "W";
  if (r === "اب" || r === "الاب" || r === "والد") return "F";
  if (r === "ام" || r === "الام" || r === "والده" || r === "والدة") return "M";
  if (r.includes("ابن")) return "S";
  if (r.includes("ابنه") || r.includes("ابنة") || r.includes("بنت")) return "D";
  if (r.includes("اخ") || r.includes("أخ")) return "B";
  return "";
}

function findColIndex(headers, keys) {
  const normalized = headers.map((h) => normalizeHeader(h));
  const wanted = keys.map((k) => normalizeHeader(k));
  for (let i = 0; i < normalized.length; i += 1) {
    const h = normalized[i];
    if (!h) continue;
    if (wanted.some((w) => h === w || h.includes(w))) return i + 1;
  }
  return 0;
}

function chooseCardCol(headers) {
  const normalized = headers.map((h) => normalizeHeader(h));
  const candidates = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const h = normalized[i];
    if (!h) continue;
    if (HEADER_KEYS.card.some((k) => {
      const nk = normalizeHeader(k);
      return h === nk || h.includes(nk);
    })) {
      candidates.push({ col: i + 1, header: h });
    }
  }
  if (candidates.length === 0) return 0;
  const exact = candidates.find((c) => /رقم البطاقه|رقم البطاقه|card_number|insurance profile$/.test(c.header));
  if (exact) return exact.col;
  return candidates[0].col;
}

function colToLetter(col) {
  let n = col;
  let out = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
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

async function main() {
  const opts = parseArgs();
  const sourcePath = path.resolve(opts.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`ملف غير موجود: ${sourcePath}`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);

  let totalRows = 0;
  let suggestedCount = 0;
  let unchangedNoCardCount = 0;

  for (const sheet of wb.worksheets) {
    const headerRow = sheet.getRow(1);
    const headers = [];
    for (let c = 1; c <= Math.max(headerRow.cellCount, 60); c += 1) {
      headers.push(toCellText(headerRow.getCell(c).value));
    }

    const nameCol = findColIndex(headers, HEADER_KEYS.name);
    const relationCol = findColIndex(headers, HEADER_KEYS.relation);
    const birthCol = findColIndex(headers, HEADER_KEYS.birth);
    const empCol = findColIndex(headers, HEADER_KEYS.emp);
    const empMainCol = findColIndex(headers, HEADER_KEYS.empMain);
    const cardCol = chooseCardCol(headers);

    if (!nameCol || !cardCol) {
      continue;
    }

    const outputCol = sheet.columnCount + 1;
    const stateCol = sheet.columnCount + 2;
    sheet.getCell(1, outputCol).value = OUTPUT_COL_TITLE;
    sheet.getCell(1, stateCol).value = STATE_COL_TITLE;

    const familyMap = new Map();

    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const name = toCellText(row.getCell(nameCol).value);
      if (!name) continue;
      const nameNorm = normalizeName(name);
      if (!nameNorm) continue;

      const relation = relationCol ? toCellText(row.getCell(relationCol).value) : "";
      const birth = birthCol ? parseDate(row.getCell(birthCol).value) : "";
      const emp = onlyDigits(empCol ? row.getCell(empCol).value : "");
      const empMain = onlyDigits(empMainCol ? row.getCell(empMainCol).value : "");
      const empKey = emp || empMain;
      const cardParsed = parseCard(row.getCell(cardCol).value);

      const familyKey = empKey || "";
      if (!familyMap.has(familyKey)) familyMap.set(familyKey, []);
      familyMap.get(familyKey).push({
        rowNumber: r,
        name,
        nameNorm,
        relation,
        relationCode: relationCode(relation),
        birth,
        empKey,
        cardParsed,
      });
    }

    for (const members of familyMap.values()) {
      if (members.length === 0) continue;

      const withCard = members.filter((m) => Boolean(m.cardParsed));
      if (withCard.length === 0) {
        for (const m of members) {
          const row = sheet.getRow(m.rowNumber);
          if (!parseCard(row.getCell(cardCol).value)) {
            row.getCell(stateCol).value = "عائلة كاملة غير مرقمة";
            unchangedNoCardCount += 1;
          }
        }
        continue;
      }

      const baseCount = new Map();
      for (const m of withCard) {
        const base = m.cardParsed.baseDigits;
        baseCount.set(base, (baseCount.get(base) || 0) + 1);
      }
      let familyBaseDigits = "";
      let best = -1;
      for (const [b, c] of baseCount.entries()) {
        if (c > best) {
          best = c;
          familyBaseDigits = b;
        }
      }
      if (!familyBaseDigits) continue;

      const usedCanonical = new Set(withCard.map((m) => m.cardParsed.full));
      const usedIndexByCode = new Map();

      for (const m of withCard) {
        const suffixInfo = parseSuffixInfo(m.cardParsed.suffix);
        if (suffixInfo.code === "MAIN") continue;
        const code = suffixInfo.code;
        if (!usedIndexByCode.has(code)) usedIndexByCode.set(code, new Set());
        const bucket = usedIndexByCode.get(code);
        if (suffixInfo.index == null) bucket.add(1);
        else bucket.add(suffixInfo.index);
      }

      const membersByCode = new Map();
      for (const m of members) {
        const code = m.relationCode || "__UNKNOWN__";
        if (!membersByCode.has(code)) membersByCode.set(code, []);
        membersByCode.get(code).push(m);
      }

      for (const list of membersByCode.values()) {
        list.sort((a, b) => {
          const aBirth = a.birth || "9999-12-31";
          const bBirth = b.birth || "9999-12-31";
          if (aBirth < bBirth) return -1;
          if (aBirth > bBirth) return 1;
          return a.rowNumber - b.rowNumber;
        });
      }

      for (const [code, list] of membersByCode.entries()) {
        if (code === "__UNKNOWN__") {
          for (const m of list) {
            if (m.cardParsed) continue;
            const row = sheet.getRow(m.rowNumber);
            row.getCell(stateCol).value = "بدون صلة واضحة";
            unchangedNoCardCount += 1;
          }
          continue;
        }

        let seq = 1;
        for (const m of list) {
          if (m.cardParsed) continue;
          const row = sheet.getRow(m.rowNumber);

          let candidate = "";
          if (code === "") {
            candidate = `WAB2025${familyBaseDigits}`;
            if (usedCanonical.has(candidate)) {
              row.getCell(stateCol).value = "الرئيسي مستخدم مسبقاً";
              unchangedNoCardCount += 1;
              continue;
            }
          } else {
            if (!usedIndexByCode.has(code)) usedIndexByCode.set(code, new Set());
            const bucket = usedIndexByCode.get(code);
            while (bucket.has(seq) || usedCanonical.has(`WAB2025${familyBaseDigits}${code}${seq}`)) {
              seq += 1;
            }
            candidate = `WAB2025${familyBaseDigits}${code}${seq}`;
            bucket.add(seq);
            seq += 1;
          }

          row.getCell(outputCol).value = candidate;
          row.getCell(stateCol).value = "مقترح من نفس العائلة داخل الملف";
          usedCanonical.add(candidate);
          suggestedCount += 1;
        }
      }
    }

    totalRows += Math.max(sheet.rowCount - 1, 0);

    const outHeader1 = sheet.getCell(1, outputCol);
    outHeader1.font = { bold: true, color: { argb: "FFFFFFFF" } };
    outHeader1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    outHeader1.alignment = { horizontal: "center", vertical: "middle" };

    const outHeader2 = sheet.getCell(1, stateCol);
    outHeader2.font = { bold: true, color: { argb: "FFFFFFFF" } };
    outHeader2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    outHeader2.alignment = { horizontal: "center", vertical: "middle" };

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: stateCol },
    };

    sheet.getColumn(outputCol).width = 28;
    sheet.getColumn(stateCol).width = 30;

    console.log(`[sheet] ${sheet.name} | added columns ${colToLetter(outputCol)}, ${colToLetter(stateCol)}`);
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

  console.log(`[summary] rows_scanned=${totalRows} | suggested=${suggestedCount} | unchanged_no_card=${unchangedNoCardCount}`);
}

main().catch((error) => {
  console.error("[error]", error?.message || error);
  process.exitCode = 1;
});

