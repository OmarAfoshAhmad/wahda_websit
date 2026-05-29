const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const EXCEL_RE = /\.(xlsx|xlsm|xls)$/i;

function toAsciiDigits(value) {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const a = "٠١٢٣٤٥٦٧٨٩".indexOf(ch);
    if (a >= 0) return String(a);
    const b = "۰۱۲۳۴۵۶۷۸۹".indexOf(ch);
    if (b >= 0) return String(b);
    return ch;
  });
}

function cleanText(value) {
  return String(value ?? "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeHeader(value) {
  return cleanText(value)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function formatDateYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateValue(value) {
  if (value == null || value === "") return "";

  if (value instanceof Date) {
    const ymd = formatDateYmd(value);
    return ymd;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const dc = XLSX.SSF.parse_date_code(value);
    if (dc && dc.y >= 1900 && dc.y <= 2100) {
      return `${String(dc.y).padStart(4, "0")}-${String(dc.m).padStart(2, "0")}-${String(dc.d).padStart(2, "0")}`;
    }
    return "";
  }

  const raw = toAsciiDigits(cleanText(value));
  if (!raw) return "";

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const ymdNative = formatDateYmd(native);
    const y = Number(ymdNative.slice(0, 4));
    if (y >= 1900 && y <= 2100) return ymdNative;
  }
  return "";
}

function normalizeCard(value) {
  const raw = cleanText(value).toUpperCase().replace(/[\s\-_]+/g, "");
  if (!raw) return "";
  const withFix = raw.replace(/\.0+$/, "");
  const m = withFix.match(/WAB2025[0-9A-Z]+/);
  if (!m) return "";
  const card = m[0];
  if (!/^WAB2025[0-9]+[A-Z0-9]*$/.test(card)) return "";
  return card;
}

function canonicalizeCard(card) {
  const c = normalizeCard(card);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;
  const n = m[1].replace(/^0+/, "") || "0";
  return `WAB2025${n}${m[2] || ""}`;
}

function isLikelyName(text) {
  if (!text) return false;
  if (text.length < 4) return false;
  if (normalizeCard(text)) return false;
  if (/^\d+$/.test(toAsciiDigits(text))) return false;
  if (!/[\u0600-\u06FFA-Za-z]/.test(text)) return false;
  const rel = normalizeHeader(text);
  const relationTerms = new Set([
    "موظف", "موظفه", "الموظف", "الموظفه", "مستفيد", "زوجه", "زوج", "ابن", "ابنه", "ابنة",
    "ام", "أم", "اب", "أب", "المستفيد", "employee", "name", "insurance", "profile",
  ]);
  if (relationTerms.has(rel)) return false;
  return true;
}

function detectHeader(rows) {
  const keys = {
    name: ["employee name", "beneficiary name", "name", "الاسم", "الأسم", "اسم المؤمن", "المستفيد"],
    card: ["insurance profile", "card", "barcode", "رقم البطاقة", "البطاقة", "الباركود"],
    birth: ["date of birth", "dob", "birth", "تاريخ الميلاد", "تاريخ الملاد", "الميلاد"],
    batch: ["batch", "الدفعة", "دفعة", "رقم الدفعة", "ben"],
  };

  const scan = Math.min(8, rows.length);
  let best = null;
  for (let r = 0; r < scan; r++) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    const mapped = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const h = normalizeHeader(row[c]);
      if (!h) continue;
      if (mapped.name == null && keys.name.some((k) => h.includes(normalizeHeader(k)))) {
        mapped.name = c;
        score += 3;
      }
      if (mapped.card == null && keys.card.some((k) => h.includes(normalizeHeader(k)))) {
        mapped.card = c;
        score += 3;
      }
      if (mapped.birth == null && keys.birth.some((k) => h.includes(normalizeHeader(k)))) {
        mapped.birth = c;
        score += 1;
      }
      if (mapped.batch == null && keys.batch.some((k) => h.includes(normalizeHeader(k)))) {
        mapped.batch = c;
        score += 1;
      }
    }
    if (score >= 4 && (mapped.card != null || mapped.name != null)) {
      if (!best || score > best.score) {
        best = { rowIndex: r, score, mapped };
      }
    }
  }
  return best;
}

function extractBatchFromText(...values) {
  for (const v of values) {
    const text = toAsciiDigits(cleanText(v));
    if (!text) continue;
    const m1 = text.match(/BEN[\s_-]*([0-9]{1,3})/i);
    if (m1) return m1[1];
    const m2 = text.match(/(?:دفعة|الدفعة|batch)\s*[:_-]?\s*([0-9]{1,3})/i);
    if (m2) return m2[1];
    const m3 = text.match(/\(([0-9]{1,3})\)/);
    if (m3) return m3[1];
  }
  return "";
}

function inferCity(filePath, sheetName) {
  const text = normalizeHeader(`${filePath} ${sheetName}`);
  const cityMap = [
    ["بنغازي", "بنغازي"],
    ["طرابلس", "طرابلس"],
    ["مصراته", "مصراتة"],
    ["مصراتة", "مصراتة"],
    ["سبها", "سبها"],
    ["سرت", "سرت"],
    ["الزاويه", "الزاوية"],
    ["الزاوية", "الزاوية"],
    ["البيضاء", "البيضاء"],
  ];
  for (const [needle, city] of cityMap) {
    if (text.includes(normalizeHeader(needle))) return city;
  }
  return "";
}

function findNameInRow(values, idxName) {
  if (idxName != null && idxName >= 0 && idxName < values.length) {
    const v = cleanText(values[idxName]);
    if (isLikelyName(v)) return v;
  }
  let best = "";
  for (const val of values) {
    const t = cleanText(val);
    if (!isLikelyName(t)) continue;
    if (t.length > best.length) best = t;
  }
  return best;
}

function findCardInRow(values, idxCard) {
  if (idxCard != null && idxCard >= 0 && idxCard < values.length) {
    const c = normalizeCard(values[idxCard]);
    if (c) return c;
  }
  for (const val of values) {
    const c = normalizeCard(val);
    if (c) return c;
  }
  return "";
}

function findBirthInRow(values, idxBirth) {
  if (idxBirth != null && idxBirth >= 0 && idxBirth < values.length) {
    const d = parseDateValue(values[idxBirth]);
    if (d) return d;
  }
  for (const val of values) {
    const d = parseDateValue(val);
    if (d) return d;
  }
  return "";
}

function collectExcelFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && EXCEL_RE.test(entry.name) && !entry.name.startsWith("~$")) {
        out.push(full);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, "ar"));
}

function writeWorkbook(filePath, rows, sheetName) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filePath);
}

function main() {
  const args = process.argv.slice(2);
  const inputDir = args[0] ? path.resolve(args[0]) : path.resolve(process.cwd());
  const outDir = args[1] ? path.resolve(args[1]) : path.join(inputDir, "جاهز_جدول_الحقيقة");

  if (!fs.existsSync(inputDir)) {
    throw new Error(`INPUT_NOT_FOUND: ${inputDir}`);
  }

  const files = collectExcelFiles(inputDir);
  if (files.length === 0) {
    throw new Error(`NO_EXCEL_FILES_IN: ${inputDir}`);
  }

  const readyMap = new Map();
  const reviewRows = [];

  for (const filePath of files) {
    let workbook;
    try {
      workbook = XLSX.readFile(filePath, { cellDates: true });
    } catch (error) {
      reviewRows.push({
        الحالة: "فشل قراءة ملف",
        سبب_المشكلة: String(error?.message || error),
        ملف_المصدر: filePath,
        ورقة_المصدر: "",
        صف_المصدر: "",
      });
      continue;
    }

    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const detected = detectHeader(rows);
      const start = detected ? detected.rowIndex + 1 : 0;
      const idxName = detected?.mapped?.name ?? null;
      const idxCard = detected?.mapped?.card ?? null;
      const idxBirth = detected?.mapped?.birth ?? null;
      const idxBatch = detected?.mapped?.batch ?? null;

      const batchHint = extractBatchFromText(filePath, path.basename(filePath), sheetName);
      const cityHint = inferCity(filePath, sheetName);

      for (let r = start; r < rows.length; r++) {
        const row = Array.isArray(rows[r]) ? rows[r] : [];
        if (row.length === 0) continue;
        if (!row.some((v) => cleanText(v) !== "")) continue;

        const card = findCardInRow(row, idxCard);
        const name = findNameInRow(row, idxName);
        const birthDate = findBirthInRow(row, idxBirth);
        const rowBatch = idxBatch != null && idxBatch >= 0 && idxBatch < row.length ? extractBatchFromText(row[idxBatch]) : "";
        const batch = rowBatch || batchHint;
        const city = cityHint || "";

        if (!card || !name) {
          if (card || name) {
            reviewRows.push({
              الحالة: "تحتاج مراجعة",
              سبب_المشكلة: !card ? "لا يوجد رقم بطاقة صالح" : "لا يوجد اسم واضح",
              رقم_البطاقة: card,
              الاسم: name,
              الميلاد: birthDate,
              الدفعة: batch,
              المدينة: city,
              ملف_المصدر: path.basename(filePath),
              ورقة_المصدر: sheetName,
              صف_المصدر: r + 1,
            });
          }
          continue;
        }

        const canonical = canonicalizeCard(card);
        const dedupeKey = `${canonical}::${batch || "__NO_BATCH__"}`;
        const existing = readyMap.get(dedupeKey);
        const candidate = {
          Employee_Name: name,
          Date_of_Birth: birthDate,
          Insurance_Profile: card,
          Batch_Number: batch,
          City: city,
          Source_File: path.basename(filePath),
          Source_Sheet: sheetName,
          Source_Row: r + 1,
        };

        if (!existing) {
          readyMap.set(dedupeKey, candidate);
        } else {
          const existingScore =
            (existing.Date_of_Birth ? 1 : 0) +
            (existing.City ? 1 : 0) +
            (existing.Batch_Number ? 1 : 0);
          const candidateScore =
            (candidate.Date_of_Birth ? 1 : 0) +
            (candidate.City ? 1 : 0) +
            (candidate.Batch_Number ? 1 : 0);
          if (candidateScore > existingScore) {
            readyMap.set(dedupeKey, candidate);
          }
        }
      }
    }
  }

  const readyRows = Array.from(readyMap.values()).sort((a, b) => {
    const ba = toAsciiDigits(a.Batch_Number || "");
    const bb = toAsciiDigits(b.Batch_Number || "");
    if (ba && bb) {
      const na = Number(ba);
      const nb = Number(bb);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    }
    return String(a.Insurance_Profile).localeCompare(String(b.Insurance_Profile), "en");
  });

  const byBatch = new Map();
  for (const row of readyRows) {
    const key = row.Batch_Number ? String(row.Batch_Number) : "بدون_دفعة";
    const arr = byBatch.get(key) || [];
    arr.push(row);
    byBatch.set(key, arr);
  }

  fs.mkdirSync(outDir, { recursive: true });

  writeWorkbook(path.join(outDir, "truth_registry_ready_all.xlsx"), readyRows, "ready_all");

  for (const [batch, rows] of byBatch.entries()) {
    const safeBatch = String(batch).replace(/[<>:\"/\\\\|?*]+/g, "_");
    writeWorkbook(
      path.join(outDir, `truth_registry_ready_batch_${safeBatch}.xlsx`),
      rows,
      "ready",
    );
  }

  writeWorkbook(path.join(outDir, "truth_registry_needs_review.xlsx"), reviewRows, "review");

  const summaryRows = [
    { metric: "input_dir", value: inputDir },
    { metric: "output_dir", value: outDir },
    { metric: "excel_files_scanned", value: files.length },
    { metric: "ready_rows", value: readyRows.length },
    { metric: "review_rows", value: reviewRows.length },
    { metric: "batches_detected", value: byBatch.size },
  ];
  writeWorkbook(path.join(outDir, "truth_registry_prepare_summary.xlsx"), summaryRows, "summary");

  console.log(`OUTPUT_DIR=${outDir}`);
  console.log(`FILES_SCANNED=${files.length}`);
  console.log(`READY_ROWS=${readyRows.length}`);
  console.log(`REVIEW_ROWS=${reviewRows.length}`);
  console.log(`BATCHES=${byBatch.size}`);
}

try {
  main();
} catch (error) {
  console.error(error?.stack || error);
  process.exit(1);
}
