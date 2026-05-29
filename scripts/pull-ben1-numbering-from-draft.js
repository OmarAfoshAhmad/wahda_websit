const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const DEFAULT_TARGET = "C:/Users/Omar/Desktop/شركة وعد/بنغازي/ترميز صحيح/BEN_1.xlsx";
const DEFAULT_SOURCE = "C:/Users/Omar/Desktop/شركة وعد/مسودات/BEN_1.xlsx";
const DEFAULT_OUTPUT = "C:/Users/Omar/Desktop/شركة وعد/بنغازي/ترميز صحيح/BEN_1_with_numbering.xlsx";

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

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
  return toAsciiDigits(String(value ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s_]/gu, "");
}

function normalizeName(value) {
  return toAsciiDigits(String(value ?? ""))
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toUpperCase();
}

function normalizeRelation(value) {
  return normalizeName(value);
}

function parseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = toAsciiDigits(String(value).trim());
  if (!s) return "";

  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    let year = String(dmy[3]);
    if (year.length === 2) year = Number(year) > 30 ? `19${year}` : `20${year}`;

    let day = a;
    let mon = b;
    if (a <= 12 && b > 12) {
      mon = a;
      day = b;
    }

    if (mon < 1 || mon > 12 || day < 1 || day > 31) return "";
    return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;

  const asDate = new Date(s);
  if (!Number.isNaN(asDate.getTime())) return asDate.toISOString().slice(0, 10);
  return "";
}

function normalizeCard(value) {
  return toAsciiDigits(String(value ?? ""))
    .toUpperCase()
    .replace(/[\u200E\u200F\u202A-\u202E]/g, " ")
    .replace(/[\s\-_]+/g, "")
    .trim();
}

function findColIndex(headerRow, keys) {
  const normalized = (headerRow || []).map((h) => normalizeHeader(h));
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (!h) continue;
    for (const key of keys) {
      const k = normalizeHeader(key);
      if (h === k || h.includes(k)) return i;
    }
  }
  return -1;
}

function addMap(map, key, card) {
  if (!key || !card) return;
  const s = map.get(key) || new Set();
  s.add(card);
  map.set(key, s);
}

function oneCardOrEmpty(setVal) {
  if (!setVal || setVal.size !== 1) return "";
  return Array.from(setVal)[0];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    target: DEFAULT_TARGET,
    source: DEFAULT_SOURCE,
    out: DEFAULT_OUTPUT,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--target") opts.target = args[++i] || opts.target;
    else if (a === "--source") opts.source = args[++i] || opts.source;
    else if (a === "--out") opts.out = args[++i] || opts.out;
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const targetPath = path.resolve(opts.target);
  const sourcePath = path.resolve(opts.source);
  const outputPath = path.resolve(opts.out);

  if (!fs.existsSync(targetPath)) throw new Error(`ملف الهدف غير موجود: ${targetPath}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`ملف المصدر غير موجود: ${sourcePath}`);

  const sourceWb = XLSX.readFile(sourcePath, { cellDates: true });
  const sourceSheetName = sourceWb.SheetNames[0];
  const sourceWs = sourceWb.Sheets[sourceSheetName];
  const sourceData = XLSX.utils.sheet_to_json(sourceWs, { header: 1, raw: false, defval: "" });
  if (!sourceData.length) throw new Error("ملف المصدر فارغ.");

  const sourceHeader = sourceData[0];
  const sName = findColIndex(sourceHeader, ["الاسم", "الأسم", "اسم المستفيد", "name"]);
  const sRelation = findColIndex(sourceHeader, ["المستفيد", "صلة القرابة", "القرابة", "relation"]);
  const sBirth = findColIndex(sourceHeader, ["تاريخ الميلاد", "تاريخ الملاد", "الميلاد", "birth", "dob"]);
  const sCard = findColIndex(sourceHeader, ["رقم البطاقة", "الباركود", "barcode", "card", "card_number"]);
  if (sName < 0 || sCard < 0) throw new Error("تعذر اكتشاف أعمدة الاسم/رقم البطاقة في ملف المصدر.");

  const byNameRelBirth = new Map();
  const byNameBirth = new Map();
  const byName = new Map();

  for (let i = 1; i < sourceData.length; i++) {
    const row = sourceData[i];
    const name = normalizeName(row[sName]);
    const rel = sRelation >= 0 ? normalizeRelation(row[sRelation]) : "";
    const birth = sBirth >= 0 ? parseDate(row[sBirth]) : "";
    const card = normalizeCard(row[sCard]);
    if (!name || !card) continue;

    addMap(byNameRelBirth, `${name}|${rel}|${birth}`, card);
    addMap(byNameBirth, `${name}|${birth}`, card);
    addMap(byName, name, card);
  }

  const targetWb = XLSX.readFile(targetPath, { cellDates: true });
  const targetSheetName = targetWb.SheetNames[0];
  const targetWs = targetWb.Sheets[targetSheetName];
  const targetData = XLSX.utils.sheet_to_json(targetWs, { header: 1, raw: false, defval: "" });
  if (!targetData.length) throw new Error("ملف الهدف فارغ.");

  const targetHeader = targetData[0];
  const tName = findColIndex(targetHeader, ["الاسم", "الأسم", "اسم المستفيد", "name"]);
  const tRelation = findColIndex(targetHeader, ["المستفيد", "صلة القرابة", "القرابة", "relation"]);
  const tBirth = findColIndex(targetHeader, ["تاريخ الميلاد", "تاريخ الملاد", "الميلاد", "birth", "dob"]);
  let tCard = findColIndex(targetHeader, ["رقم البطاقة", "الباركود", "barcode", "card", "card_number"]);
  if (tName < 0) throw new Error("تعذر اكتشاف عمود الاسم في ملف الهدف.");

  if (tCard < 0) {
    tCard = targetHeader.length;
    targetHeader[tCard] = "رقم البطاقة";
  } else if (!targetHeader[tCard]) {
    targetHeader[tCard] = "رقم البطاقة";
  }

  let matched = 0;
  let ambiguous = 0;
  let missing = 0;
  let alreadyFilled = 0;

  for (let i = 1; i < targetData.length; i++) {
    const row = targetData[i];
    const name = normalizeName(row[tName]);
    if (!name) continue;
    const rel = tRelation >= 0 ? normalizeRelation(row[tRelation]) : "";
    const birth = tBirth >= 0 ? parseDate(row[tBirth]) : "";

    const current = normalizeCard(row[tCard]);
    if (current) {
      alreadyFilled += 1;
      continue;
    }

    const c1 = oneCardOrEmpty(byNameRelBirth.get(`${name}|${rel}|${birth}`));
    const c2 = oneCardOrEmpty(byNameBirth.get(`${name}|${birth}`));
    const c3 = oneCardOrEmpty(byName.get(name));
    const card = c1 || c2 || c3;

    if (card) {
      row[tCard] = card;
      matched += 1;
      continue;
    }

    const set1 = byNameRelBirth.get(`${name}|${rel}|${birth}`);
    const set2 = byNameBirth.get(`${name}|${birth}`);
    const set3 = byName.get(name);
    if ((set1 && set1.size > 1) || (set2 && set2.size > 1) || (set3 && set3.size > 1)) ambiguous += 1;
    else missing += 1;
  }

  const outWs = XLSX.utils.aoa_to_sheet(targetData);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outWs, targetSheetName || "Sheet1");
  XLSX.writeFile(outWb, outputPath);

  const reportPath = path.join(path.dirname(outputPath), "BEN_1_numbering_report.txt");
  fs.writeFileSync(
    reportPath,
    [
      `source: ${sourcePath}`,
      `target: ${targetPath}`,
      `output: ${outputPath}`,
      "",
      `rows_target: ${Math.max(0, targetData.length - 1)}`,
      `filled_from_source: ${matched}`,
      `already_had_card: ${alreadyFilled}`,
      `ambiguous_need_manual_review: ${ambiguous}`,
      `not_found_in_source: ${missing}`,
    ].join("\n"),
    "utf8",
  );

  console.log(`[ok] output=${outputPath}`);
  console.log(`[ok] report=${reportPath}`);
  console.log(
    `[stats] matched=${matched} already_filled=${alreadyFilled} ambiguous=${ambiguous} missing=${missing}`,
  );
}

try {
  main();
} catch (err) {
  console.error("[error]", err?.message || err);
  process.exitCode = 1;
}

