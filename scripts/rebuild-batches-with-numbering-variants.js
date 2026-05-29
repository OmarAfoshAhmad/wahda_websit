const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

const DEFAULT_ROOT = "C:/Users/Omar/Desktop/شركة وعد/بنغازي";
const DEFAULT_SOURCE = "C:/Users/Omar/Desktop/شركة وعد/دفعات مجمعة.xlsx";

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const HEADER_KEYS = {
  name: [
    "الاسم",
    "الأسم",
    "اسم",
    "اسم المستفيد",
    "المستفيد",
    "beneficiary",
    "name",
    "beneficiary_name",
  ],
  relation: ["المستفيد", "صلة القرابة", "القرابة", "relationship", "relation"],
  birth: ["تاريخ الميلاد", "تاريخ الملاد", "الميلاد", "المواليد", "birth", "dob", "birth_date"],
  emp: ["رقم الوظيفي", "الرقم الوظيفي", "رقم وظيفي", "employee", "emp", "employee_number"],
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
  batch: ["الدفعة", "رقم الدفعة", "batch", "batch number", "batch_number", "batch no", "batch_no"],
};

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
    if (year.length === 2) {
      year = Number(year) > 30 ? `19${year}` : `20${year}`;
    }
    let day = a;
    let mon = b;

    // دعم صيغتين: DD/MM/YY و MM/DD/YY
    if (a <= 12 && b > 12) {
      mon = a;
      day = b;
    } else if (a > 12 && b <= 12) {
      day = a;
      mon = b;
    }

    if (mon < 1 || mon > 12 || day < 1 || day > 31) {
      return "";
    }
    return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  }

  const asDate = new Date(s);
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.toISOString().slice(0, 10);
  }
  return "";
}

function cleanEmp(value) {
  const digits = toAsciiDigits(String(value ?? "")).replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

function normalizeBatch(value) {
  const v = toAsciiDigits(String(value ?? "")).trim();
  if (!v) return "";
  const m = v.match(/\d{1,3}/);
  return m ? String(Number(m[0])) : "";
}

function extractBatchFromText(text, options = {}) {
  const { allowGeneric = false, allowDirect = true } = options;
  const s = toAsciiDigits(String(text ?? "").trim());
  if (!s) return "";

  if (allowDirect) {
    const direct = s.match(/^([0-9]{1,3})$/);
    if (direct) return normalizeBatch(direct[1]);
  }

  const ar = s.match(/دفع[هة]\s*([0-9]{1,3})/i);
  if (ar) return normalizeBatch(ar[1]);

  const en = s.match(/batch\s*[-_ ]*([0-9]{1,3})/i);
  if (en) return normalizeBatch(en[1]);

  const ben = s.match(/(?:BEN|TRI)\s*[-_ ]*([0-9]{1,3})/i);
  if (ben) return normalizeBatch(ben[1]);

  if (allowGeneric) {
    const g = s.match(/(^|[^0-9])([0-9]{1,3})([^0-9]|$)/);
    if (g) return normalizeBatch(g[2]);
  }
  return "";
}

function parseCardCandidates(value) {
  const raw = toAsciiDigits(String(value ?? ""))
    .toUpperCase()
    .replace(/[\u200E\u200F\u202A-\u202E]/g, " ")
    .replace(/[\s\-_]+/g, "");
  if (!raw) return [];

  const matches = raw.match(/WAB2025[0-9A-Z]+/g) || [];
  return Array.from(new Set(matches));
}

function canonicalizeCard(card) {
  const c = String(card ?? "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
  const m = c.match(/^WAB20250*([0-9]+)([A-Z][0-9]*)?$/);
  if (!m) return c;
  const digits = (m[1] || "").replace(/^0+/, "") || "0";
  const suffix = m[2] || "";
  return `WAB2025${digits}${suffix}`;
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

function collectExcelFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.startsWith("~$")) continue;
      if (/\.(xlsx|xlsm)$/i.test(entry.name)) out.push(abs);
    }
  }
  return out;
}

function pathToPosix(p) {
  return String(p || "").replace(/\\/g, "/");
}

function scoreCandidate(row) {
  let score = 0;
  if (row.card_list && row.card_list.length > 0) score += 4;
  if (row.birth) score += 2;
  if (row.relation) score += 1;
  if (row.emp_no) score += 1;
  return score;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    root: DEFAULT_ROOT,
    source: DEFAULT_SOURCE,
    outDir: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") opts.root = args[++i] || opts.root;
    else if (a === "--source") opts.source = args[++i] || opts.source;
    else if (a === "--out-dir") opts.outDir = args[++i] || "";
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const rootDir = path.resolve(opts.root);
  const sourcePath = path.resolve(opts.source);
  if (!fs.existsSync(rootDir)) throw new Error(`المسار غير موجود: ${rootDir}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`ملف الدفعات المجمعة غير موجود: ${sourcePath}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = opts.outDir
    ? path.resolve(opts.outDir)
    : path.resolve(process.cwd(), "exports", `batch_rebuild_${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`[info] root=${rootDir}`);
  console.log(`[info] source=${sourcePath}`);
  console.log(`[info] out=${outDir}`);

  const sourceWb = XLSX.readFile(sourcePath, { cellDates: true });
  const sourceByBatch = new Map();
  let sourceRowsCount = 0;

  for (const sheetName of sourceWb.SheetNames) {
    const batchFromSheet = extractBatchFromText(sheetName, { allowGeneric: false, allowDirect: true });
    if (!batchFromSheet) continue;
    const ws = sourceWb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    if (!matrix.length) continue;
    const header = matrix[0];

    const idxName = findColIndex(header, HEADER_KEYS.name);
    if (idxName < 0) continue;
    const idxRelation = findColIndex(header, HEADER_KEYS.relation);
    const idxBirth = findColIndex(header, HEADER_KEYS.birth);
    const idxEmp = findColIndex(header, HEADER_KEYS.emp);

    const rows = sourceByBatch.get(batchFromSheet) || [];
    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r];
      const name = String(row[idxName] ?? "").trim();
      if (!name) continue;
      const nameNorm = normalizeName(name);
      if (!nameNorm) continue;

      const relation = idxRelation >= 0 ? String(row[idxRelation] ?? "").trim() : "";
      const birth = idxBirth >= 0 ? parseDate(row[idxBirth]) : "";
      const empNo = idxEmp >= 0 ? cleanEmp(row[idxEmp]) : "";

      rows.push({
        batch: batchFromSheet,
        name,
        name_norm: nameNorm,
        relation,
        birth,
        emp_no: empNo,
        source_file: sourcePath,
        source_sheet: sheetName,
        source_row: r + 1,
        is_added: false,
      });
      sourceRowsCount += 1;
    }
    sourceByBatch.set(batchFromSheet, rows);
  }

  if (sourceByBatch.size === 0) {
    throw new Error("لم أستطع استخراج دفعات من ملف المصدر. تأكد أن أسماء الشيتات تحتوي رقم دفعة.");
  }
  console.log(`[info] source batches=${sourceByBatch.size}, source rows=${sourceRowsCount}`);

  const excelFiles = collectExcelFiles(rootDir).filter((p) => path.resolve(p) !== sourcePath);
  console.log(`[info] reference excel files=${excelFiles.length}`);

  const cardsByName = new Map();
  const batchNameCandidate = new Map();
  const numberingNoBatchByName = new Map();
  let scannedRows = 0;

  for (const filePath of excelFiles) {
    let wb;
    try {
      wb = XLSX.readFile(filePath, { cellDates: true });
    } catch {
      continue;
    }
    const relFile = pathToPosix(path.relative(rootDir, filePath));
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      if (!matrix.length) continue;
      const header = matrix[0];
      const idxName = findColIndex(header, HEADER_KEYS.name);
      if (idxName < 0) continue;
      const idxRelation = findColIndex(header, HEADER_KEYS.relation);
      const idxBirth = findColIndex(header, HEADER_KEYS.birth);
      const idxEmp = findColIndex(header, HEADER_KEYS.emp);
      const idxCard = findColIndex(header, HEADER_KEYS.card);
      const idxBatch = findColIndex(header, HEADER_KEYS.batch);

      // للفهارس المرجعية نمنع التعرف من رقم مجرد (مثل اسم ورقة "1")
      const batchFromPath = extractBatchFromText(relFile, { allowGeneric: false, allowDirect: false });
      const batchFromFile = extractBatchFromText(path.basename(filePath), { allowGeneric: false, allowDirect: false });
      const batchFromSheet = extractBatchFromText(sheetName, { allowGeneric: false, allowDirect: false });
      const fallbackBatch = batchFromPath || batchFromFile || batchFromSheet || "";

      for (let r = 1; r < matrix.length; r++) {
        scannedRows += 1;
        const row = matrix[r];
        const name = String(row[idxName] ?? "").trim();
        if (!name) continue;
        const nameNorm = normalizeName(name);
        if (!nameNorm) continue;

        const relation = idxRelation >= 0 ? String(row[idxRelation] ?? "").trim() : "";
        const birth = idxBirth >= 0 ? parseDate(row[idxBirth]) : "";
        const empNo = idxEmp >= 0 ? cleanEmp(row[idxEmp]) : "";

        const rowBatch = idxBatch >= 0 ? normalizeBatch(row[idxBatch]) : "";
        const batch = rowBatch || fallbackBatch;

        const cardText = idxCard >= 0 ? String(row[idxCard] ?? "") : "";
        const cardsRaw = parseCardCandidates(cardText);
        const cardsCanonical = cardsRaw.map((c) => canonicalizeCard(c));

        if (cardsRaw.length > 0) {
          const bucket = cardsByName.get(nameNorm) || [];
          for (let i = 0; i < cardsRaw.length; i++) {
            bucket.push({
              raw: cardsRaw[i],
              canonical: cardsCanonical[i],
              batch,
              file: relFile,
              sheet: sheetName,
              row: r + 1,
            });
            if (!batch) {
              const nb = numberingNoBatchByName.get(nameNorm) || [];
              nb.push({
                raw: cardsRaw[i],
                canonical: cardsCanonical[i],
                file: relFile,
                sheet: sheetName,
                row: r + 1,
              });
              numberingNoBatchByName.set(nameNorm, nb);
            }
          }
          cardsByName.set(nameNorm, bucket);
        }

        if (!batch) continue;
        // لا نعتبر مرشح إضافة إلا إذا وجد ترقيم فعلي
        if (cardsRaw.length === 0) continue;
        const candidate = {
          batch,
          name,
          name_norm: nameNorm,
          relation,
          birth,
          emp_no: empNo,
          card_list: cardsRaw,
          source_file: filePath,
          source_sheet: sheetName,
          source_row: r + 1,
        };
        const key = `${batch}::${nameNorm}`;
        const prev = batchNameCandidate.get(key);
        if (!prev || scoreCandidate(candidate) > scoreCandidate(prev)) {
          batchNameCandidate.set(key, candidate);
        }
      }
    }
  }
  console.log(`[info] scanned reference rows=${scannedRows}`);
  console.log(`[info] names with cards=${cardsByName.size}`);

  const sortedBatches = Array.from(sourceByBatch.keys()).sort((a, b) => Number(a) - Number(b));
  const summaryRows = [];
  const unresolvedNoBatchRows = [];
  const unresolvedNoBatchSeen = new Set();

  for (const batch of sortedBatches) {
    const originals = sourceByBatch.get(batch) || [];
    const existingNames = new Set(originals.map((r) => r.name_norm));

    for (const r of originals) {
      const refs = cardsByName.get(r.name_norm) || [];
      if (refs.length === 0) continue;
      const hasAnyBatch = refs.some((x) => Boolean(x.batch));
      if (hasAnyBatch) continue;

      const noBatchRefs = numberingNoBatchByName.get(r.name_norm) || [];
      if (noBatchRefs.length === 0) continue;
      const dedupeKey = `${batch}::${r.name_norm}::${r.birth || ""}`;
      if (unresolvedNoBatchSeen.has(dedupeKey)) continue;
      unresolvedNoBatchSeen.add(dedupeKey);

      unresolvedNoBatchRows.push({
        batch,
        name: r.name,
        relation: r.relation || "",
        birth: r.birth || "",
        emp: r.emp_no || "",
        cards_raw: Array.from(new Set(noBatchRefs.map((x) => x.raw).filter(Boolean))).join(" | "),
        cards_norm: Array.from(new Set(noBatchRefs.map((x) => x.canonical).filter(Boolean))).join(" | "),
        refs: Array.from(
          new Set(noBatchRefs.map((x) => `${x.file} | ${x.sheet} | صف ${x.row}`)),
        ).slice(0, 12).join(" || "),
        note: "تم العثور على ترقيم بدون رقم دفعة",
      });
    }

    const additions = [];
    for (const [key, c] of batchNameCandidate.entries()) {
      if (!key.startsWith(`${batch}::`)) continue;
      if (existingNames.has(c.name_norm)) continue;
      additions.push({
        batch,
        name: c.name,
        name_norm: c.name_norm,
        relation: c.relation,
        birth: c.birth,
        emp_no: c.emp_no,
        source_file: c.source_file,
        source_sheet: c.source_sheet,
        source_row: c.source_row,
        is_added: true,
      });
      existingNames.add(c.name_norm);
    }

    const allRows = [...originals, ...additions];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Batch_${batch}`);
    ws.views = [{ rightToLeft: true }];
    ws.columns = [
      { header: "الحالة", key: "status", width: 12 },
      { header: "الدفعة", key: "batch", width: 10 },
      { header: "الاسم", key: "name", width: 36 },
      { header: "المستفيد", key: "relation", width: 14 },
      { header: "تاريخ الميلاد", key: "birth", width: 14 },
      { header: "رقم الوظيفي", key: "emp", width: 14 },
      { header: "كل الترميزات المكتشفة (خام)", key: "cards_raw", width: 52 },
      { header: "كل الترميزات بعد التطبيع", key: "cards_norm", width: 52 },
      { header: "عدد الترميزات", key: "cards_count", width: 12 },
      { header: "مصادر الترميزات", key: "sources", width: 64 },
      { header: "مصدر السجل", key: "origin", width: 36 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E78" },
    };

    let originalCount = 0;
    let addedCount = 0;
    let namesWithMultipleCards = 0;

    for (const r of allRows) {
      const cardRefs = cardsByName.get(r.name_norm) || [];
      const rawSet = new Set(cardRefs.map((x) => String(x.raw || "").trim()).filter(Boolean));
      const normSet = new Set(cardRefs.map((x) => String(x.canonical || "").trim()).filter(Boolean));
      if (normSet.size > 1 || rawSet.size > 1) namesWithMultipleCards += 1;

      const sourceSet = new Set(
        cardRefs
          .map((x) => `${x.file} | ${x.sheet} | صف ${x.row}${x.batch ? ` | دفعة ${x.batch}` : ""}`)
          .filter(Boolean),
      );

      const row = ws.addRow({
        status: r.is_added ? "مضاف" : "أصلي",
        batch: r.batch,
        name: r.name,
        relation: r.relation || "",
        birth: r.birth || "",
        emp: r.emp_no || "",
        cards_raw: Array.from(rawSet).join(" | "),
        cards_norm: Array.from(normSet).join(" | "),
        cards_count: Math.max(rawSet.size, normSet.size),
        sources: Array.from(sourceSet).slice(0, 10).join(" || "),
        origin: r.is_added
          ? `${pathToPosix(path.relative(rootDir, r.source_file))} | ${r.source_sheet} | ${r.source_row}`
          : `الملف الأصلي المجمّع | ${r.source_sheet} | ${r.source_row}`,
      });

      row.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
      if (r.is_added) {
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF2CC" },
        };
        addedCount += 1;
      } else {
        originalCount += 1;
      }
    }

    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columns.length },
    };

    ws.eachRow((row, rowNumber) => {
      row.height = rowNumber === 1 ? 24 : 21;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
      });
    });

    const fileName = `دفعة_${batch}_منسقة_مع_الترميزات.xlsx`;
    const outFile = path.join(outDir, fileName);
    await wb.xlsx.writeFile(outFile);

    summaryRows.push({
      batch,
      originals: originalCount,
      added: addedCount,
      total: allRows.length,
      multi_cards: namesWithMultipleCards,
      file: outFile,
    });

    console.log(`[done] batch=${batch} | originals=${originalCount} | added=${addedCount} | file=${outFile}`);
  }

  const summaryWb = new ExcelJS.Workbook();
  const summaryWs = summaryWb.addWorksheet("summary");
  summaryWs.views = [{ rightToLeft: true }];
  summaryWs.columns = [
    { header: "الدفعة", key: "batch", width: 10 },
    { header: "الأصلي", key: "originals", width: 10 },
    { header: "المضاف", key: "added", width: 10 },
    { header: "الإجمالي", key: "total", width: 10 },
    { header: "حالات تعدد ترميز بالاسم", key: "multi_cards", width: 24 },
    { header: "الملف الناتج", key: "file", width: 74 },
  ];
  const summaryHeader = summaryWs.getRow(1);
  summaryHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  summaryHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F766E" },
  };

  summaryRows.forEach((r) => summaryWs.addRow(r));
  summaryWs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: summaryWs.columns.length },
  };

  const summaryPath = path.join(outDir, "ملخص_الدفعات_المنسقة.xlsx");
  await summaryWb.xlsx.writeFile(summaryPath);

  const unresolvedPath = path.join(outDir, "ترميزات_بدون_دفعة_للمراجعة.xlsx");
  const unresolvedWb = new ExcelJS.Workbook();
  const unresolvedWs = unresolvedWb.addWorksheet("no_batch_numbering");
  unresolvedWs.views = [{ rightToLeft: true }];
  unresolvedWs.columns = [
    { header: "الدفعة الأصلية بالمجمع", key: "batch", width: 16 },
    { header: "الاسم", key: "name", width: 36 },
    { header: "المستفيد", key: "relation", width: 14 },
    { header: "تاريخ الميلاد", key: "birth", width: 14 },
    { header: "رقم الوظيفي", key: "emp", width: 14 },
    { header: "الترميزات الخام", key: "cards_raw", width: 44 },
    { header: "الترميزات بعد التطبيع", key: "cards_norm", width: 44 },
    { header: "مصادر الاكتشاف", key: "refs", width: 72 },
    { header: "ملاحظة", key: "note", width: 34 },
  ];
  const unresolvedHeader = unresolvedWs.getRow(1);
  unresolvedHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  unresolvedHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF7C2D12" },
  };
  unresolvedNoBatchRows.forEach((r) => unresolvedWs.addRow(r));
  unresolvedWs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: unresolvedWs.columns.length },
  };
  await unresolvedWb.xlsx.writeFile(unresolvedPath);

  const txtReport = path.join(outDir, "README.txt");
  const totalOriginal = summaryRows.reduce((s, r) => s + r.originals, 0);
  const totalAdded = summaryRows.reduce((s, r) => s + r.added, 0);
  const totalRows = summaryRows.reduce((s, r) => s + r.total, 0);
  const totalMultiCards = summaryRows.reduce((s, r) => s + r.multi_cards, 0);

  fs.writeFileSync(
    txtReport,
    [
      `المصدر: ${sourcePath}`,
      `مسار البحث: ${rootDir}`,
      `عدد ملفات الإخراج (دفعات): ${summaryRows.length}`,
      `إجمالي السجلات الأصلية: ${totalOriginal}`,
      `إجمالي السجلات المضافة: ${totalAdded}`,
      `إجمالي السجلات النهائية: ${totalRows}`,
      `إجمالي حالات تعدد الترميز (بالاسم): ${totalMultiCards}`,
      `حالات ترقيم مكتشفة بدون دفعة: ${unresolvedNoBatchRows.length}`,
      "",
      "ملاحظة: الصفوف المضافة تم تظليلها بلون أصفر فاتح.",
      "ملاحظة: المطابقة الأساسية تمت بالاسم بعد التطبيع.",
      "ملاحظة: الإضافة تمت فقط عندما كانت الدفعة مساوية لدفعة الملف المجمّع.",
    ].join("\n"),
    "utf8",
  );

  console.log(`[summary] ${summaryPath}`);
  console.log(`[summary] ${unresolvedPath}`);
  console.log(`[summary] ${txtReport}`);
  console.log(`[ok] DONE`);
}

main().catch((err) => {
  console.error("[error]", err?.message || err);
  process.exitCode = 1;
});
