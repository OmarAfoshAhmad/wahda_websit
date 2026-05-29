const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");

const DEFAULT_SOURCE = "C:/Users/Omar/waad_temp_website/ملاحق الوحدة/الوحده ملحق سابق 1.xlsx";
const DEFAULT_OUT_DIR = "C:/Users/Omar/waad_temp_website/ملاحق الوحدة/جاهز_جدول_الحقيقة_من_ملحق_سابق1";

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

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toUpperCase();
}

function birthKey(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = toAsciiDigits(String(value).trim());
  if (!s) return "";
  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  const loose = s.match(/(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})/);
  if (loose) return `${loose[1]}-${String(loose[2]).padStart(2, "0")}-${String(loose[3]).padStart(2, "0")}`;
  return "";
}

function cleanEmpNumber(value) {
  const digits = toAsciiDigits(String(value ?? "")).replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

function relationNorm(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

function relationCode(value) {
  const r = relationNorm(value);
  if (!r) return "";
  if (r === "موظف" || r === "الموظف" || r === "موظفه" || r === "الموظفه") return "";
  if (r === "زوجه" || r === "الزوجه" || r === "زوجه" || r === "الزوجه") return "W";
  if (r === "ابن" || r === "الابن" || r === "ابن" || r === "ابن") return "S";
  if (r === "ابنه" || r === "ابنه" || r === "ابنة" || r === "الابنه" || r === "الابنة") return "D";
  if (r === "اب" || r === "الاب") return "F";
  if (r === "ام" || r === "الام") return "M";
  return "";
}

function baseCardFromEmp(empNo) {
  const n = cleanEmpNumber(empNo);
  if (!n) return "";
  return `WAB2025${n.padStart(6, "0")}`;
}

function canonicalizeCard(value) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
  const m = raw.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return raw;
  const digits = m[1].replace(/^0+/, "") || "0";
  return `WAB2025${digits}${m[2] || ""}`;
}

function suffixCodeFromCard(card) {
  const c = String(card ?? "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
  const m = c.match(/^WAB2025\d+([A-Z])[0-9]*$/);
  return m?.[1] || "";
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const s1 = a.length >= b.length ? a : b;
  const s2 = a.length >= b.length ? b : a;
  if (s1.includes(s2)) return s2.length / s1.length;
  const bigrams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      out.set(bg, (out.get(bg) || 0) + 1);
    }
    return out;
  };
  const m1 = bigrams(s1);
  const m2 = bigrams(s2);
  let intersect = 0;
  for (const [k, v1] of m1.entries()) {
    const v2 = m2.get(k) || 0;
    intersect += Math.min(v1, v2);
  }
  const total = Math.max((s1.length - 1) + (s2.length - 1), 1);
  return (2 * intersect) / total;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    source: DEFAULT_SOURCE,
    outDir: DEFAULT_OUT_DIR,
    envFile: "",
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--source") out.source = args[++i] ?? out.source;
    else if (a === "--out-dir") out.outDir = args[++i] ?? out.outDir;
    else if (a === "--env") out.envFile = args[++i] ?? "";
  }
  return out;
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

function ensureDbUrl(envFileArg) {
  if (process.env.DATABASE_URL) return;
  const candidates = [];
  if (envFileArg) candidates.push(path.resolve(process.cwd(), envFileArg));
  candidates.push(path.resolve(process.cwd(), ".env.production"));
  candidates.push(path.resolve(process.cwd(), ".env"));
  for (const c of candidates) {
    if (loadEnvFile(c) && process.env.DATABASE_URL) return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL غير موجود. مرره عبر --env أو متغير البيئة.");
  }
}

function extractBatchMarker(cells) {
  for (const cell of cells) {
    const s = toAsciiDigits(String(cell ?? "").trim()).toUpperCase();
    const m = s.match(/^BEN\s*([0-9]{1,3})$/);
    if (m) return m[1];
  }
  return "";
}

function buildGeneratedCardResolver(rows) {
  const state = new Map();
  return (row) => {
    const base = baseCardFromEmp(row.emp_no);
    if (!base) return "";
    const famKey = `${row.batch}::${row.emp_no}`;
    if (!state.has(famKey)) state.set(famKey, { used: new Set(), seq: new Map(), hasBase: false });
    const fam = state.get(famKey);
    const code = relationCode(row.relation);
    if (!code) {
      if (!fam.hasBase) {
        fam.hasBase = true;
        fam.used.add(base);
        return base;
      }
      const k = "X";
      const n = (fam.seq.get(k) || 0) + 1;
      fam.seq.set(k, n);
      const card = `${base}X${n}`;
      fam.used.add(card);
      return card;
    }
    const n = (fam.seq.get(code) || 0) + 1;
    fam.seq.set(code, n);
    const card = `${base}${code}${n}`;
    fam.used.add(card);
    return card;
  };
}

async function main() {
  const opts = parseArgs();
  ensureDbUrl(opts.envFile);

  const sourcePath = path.resolve(process.cwd(), opts.source);
  const outDir = path.resolve(process.cwd(), opts.outDir);
  if (!fs.existsSync(sourcePath)) throw new Error(`الملف غير موجود: ${sourcePath}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);
  if (wb.worksheets.length === 0) throw new Error("الملف لا يحتوي أي شيت.");

  const sourceRows = [];
  for (const ws of wb.worksheets) {
    let currentBatch = "1";
    for (let r = 1; r <= ws.rowCount; r++) {
      const c1 = ws.getRow(r).getCell(1).value;
      const c2 = ws.getRow(r).getCell(2).value;
      const c3 = ws.getRow(r).getCell(3).value;
      const c4 = ws.getRow(r).getCell(4).value;

      const marker = extractBatchMarker([c1, c2, c3, c4]);
      if (marker) {
        currentBatch = marker;
        continue;
      }

      const empNo = cleanEmpNumber(c1);
      const name = String(c2 ?? "").trim();
      if (!empNo || !name) continue;

      sourceRows.push({
        sheet: ws.name,
        source_row: r,
        batch: currentBatch,
        emp_no: empNo,
        name,
        name_norm: normalizeName(name),
        relation: String(c3 ?? "").trim(),
        birth: birthKey(c4),
      });
    }
  }

  // إزالة التكرار بين الشيتات
  const uniqMap = new Map();
  for (const row of sourceRows) {
    const key = `${row.batch}::${row.emp_no}::${row.name_norm}::${row.birth}`;
    if (!uniqMap.has(key)) uniqMap.set(key, row);
  }
  const rows = Array.from(uniqMap.values());

  const prisma = new PrismaClient();
  const systemRows = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: { card_number: true, name: true, birth_date: true },
  });
  await prisma.$disconnect();

  // فهرسة المنظومة حسب الرقم الوظيفي المستنتج من البطاقة
  const systemByEmp = new Map();
  for (const item of systemRows) {
    const card = String(item.card_number ?? "").trim().toUpperCase();
    const m = card.replace(/[\s\-_]+/g, "").match(/^WAB2025(\d+)([A-Z0-9]*)$/);
    if (!m) continue;
    const empNo = m[1].replace(/^0+/, "") || "0";
    const rec = {
      card,
      canonical: canonicalizeCard(card),
      name: String(item.name ?? "").trim(),
      name_norm: normalizeName(item.name),
      birth: item.birth_date ? new Date(item.birth_date).toISOString().slice(0, 10) : "",
      suffix: suffixCodeFromCard(card),
    };
    if (!systemByEmp.has(empNo)) systemByEmp.set(empNo, []);
    systemByEmp.get(empNo).push(rec);
  }

  const resolveGenerated = buildGeneratedCardResolver(rows);
  const resolved = [];
  const usedByFamily = new Map();

  for (const row of rows) {
    const famKey = `${row.batch}::${row.emp_no}`;
    if (!usedByFamily.has(famKey)) usedByFamily.set(famKey, new Set());
    const used = usedByFamily.get(famKey);

    const candidates = (systemByEmp.get(row.emp_no) || []).filter((c) => !used.has(c.card));
    const relCode = relationCode(row.relation);

    let chosen = null;
    let method = "";

    // 1) تطابق الاسم داخل نفس الرقم الوظيفي
    const sameName = candidates.filter((c) => c.name_norm === row.name_norm);
    if (sameName.length === 1) {
      chosen = sameName[0];
      method = "emp+name_exact";
    } else if (sameName.length > 1 && row.birth) {
      const sameNameBirth = sameName.filter((c) => c.birth === row.birth);
      if (sameNameBirth.length === 1) {
        chosen = sameNameBirth[0];
        method = "emp+name+birth";
      }
    }

    // 2) تطابق الميلاد الفريد
    if (!chosen && row.birth) {
      const birthMatches = candidates.filter((c) => c.birth === row.birth);
      if (birthMatches.length === 1) {
        chosen = birthMatches[0];
        method = "emp+birth_unique";
      }
    }

    // 3) لو الصلة واضحة، رجّح البطاقات بنفس كود الصلة
    if (!chosen && relCode) {
      const sameSuffix = candidates.filter((c) => c.suffix === relCode);
      if (sameSuffix.length === 1) {
        chosen = sameSuffix[0];
        method = "emp+relation_suffix";
      }
    }

    // 4) تقريب اسم داخل نفس الرقم الوظيفي
    if (!chosen && candidates.length > 0) {
      const scored = candidates.map((c) => ({
        rec: c,
        score: similarity(row.name_norm, c.name_norm),
      })).sort((a, b) => b.score - a.score);
      const top = scored[0];
      const second = scored[1];
      if (top && top.score >= 0.78 && (!second || top.score - second.score >= 0.08)) {
        chosen = top.rec;
        method = "emp+name_fuzzy";
      }
    }

    let card = "";
    let confidence = "";
    if (chosen) {
      card = chosen.card;
      used.add(chosen.card);
      confidence = method === "emp+name_fuzzy" ? "medium" : "high";
    } else {
      card = resolveGenerated(row);
      confidence = "low";
      method = card ? "generated_from_emp_relation" : "unresolved";
    }

    resolved.push({
      batch: row.batch,
      emp_no: row.emp_no,
      name: row.name,
      birth: row.birth,
      relation: row.relation,
      card_number: card,
      method,
      confidence,
      source_sheet: row.sheet,
      source_row: row.source_row,
    });
  }

  const readyRows = resolved.filter((r) => r.card_number && r.card_number.startsWith("WAB2025") && r.confidence !== "low");
  const reviewRows = resolved.filter((r) => r.confidence === "low" || !r.card_number || !r.card_number.startsWith("WAB2025"));
  const aggressiveRows = resolved.filter((r) => r.card_number && r.card_number.startsWith("WAB2025"));
  const byBatch = new Map();
  for (const row of readyRows) {
    if (!byBatch.has(row.batch)) byBatch.set(row.batch, []);
    byBatch.get(row.batch).push(row);
  }
  const byBatchAggressive = new Map();
  for (const row of aggressiveRows) {
    if (!byBatchAggressive.has(row.batch)) byBatchAggressive.set(row.batch, []);
    byBatchAggressive.get(row.batch).push(row);
  }

  // ملف شامل جاهز للاستيراد
  const readyWb = new ExcelJS.Workbook();
  const readyAll = readyWb.addWorksheet("all_ready");
  readyAll.columns = [
    { header: "رقم البطاقة", key: "card_number", width: 24 },
    { header: "الاسم", key: "name", width: 34 },
    { header: "الميلاد", key: "birth", width: 14 },
    { header: "رقم_الموظف", key: "emp_no", width: 14 },
    { header: "الصلة", key: "relation", width: 14 },
    { header: "الدفعة", key: "batch", width: 10 },
    { header: "طريقة_التحديد", key: "method", width: 24 },
    { header: "الثقة", key: "confidence", width: 10 },
    { header: "ورقة_المصدر", key: "source_sheet", width: 18 },
    { header: "صف_المصدر", key: "source_row", width: 10 },
  ];
  readyRows.forEach((r) => readyAll.addRow(r));

  // إنشاء شيت لكل دفعة + ملف مستقل لكل دفعة
  const sortedBatches = Array.from(byBatch.keys()).sort((a, b) => Number(a) - Number(b));
  for (const batch of sortedBatches) {
    const rowsBatch = byBatch.get(batch) || [];
    const ws = readyWb.addWorksheet(`BEN${batch}`);
    ws.columns = readyAll.columns;
    rowsBatch.forEach((r) => ws.addRow(r));

    const wbBatch = new ExcelJS.Workbook();
    const s = wbBatch.addWorksheet("ready");
    s.columns = readyAll.columns;
    rowsBatch.forEach((r) => s.addRow(r));
    const batchFile = path.join(outDir, `ملحق_${batch}_جاهز_للاستيراد_جدول_الحقيقة.xlsx`);
    await wbBatch.xlsx.writeFile(batchFile);
  }

  // ملف المراجعة
  const reviewWb = new ExcelJS.Workbook();
  const reviewWs = reviewWb.addWorksheet("needs_review");
  reviewWs.columns = readyAll.columns;
  reviewRows.forEach((r) => reviewWs.addRow(r));

  const readyAllPath = path.join(outDir, "ملاحق_الوحدة_جاهز_للاستيراد_جدول_الحقيقة.xlsx");
  const reviewPath = path.join(outDir, "ملاحق_الوحدة_تحتاج_مراجعة.xlsx");
  await readyWb.xlsx.writeFile(readyAllPath);
  await reviewWb.xlsx.writeFile(reviewPath);

  // نسخة جريئة: تضم الجاهز + المولد آلياً (ثقة منخفضة) طالما البطاقة صالحة
  const aggressiveWb = new ExcelJS.Workbook();
  const aggressiveAll = aggressiveWb.addWorksheet("all_aggressive");
  aggressiveAll.columns = readyAll.columns;
  aggressiveRows.forEach((r) =>
    aggressiveAll.addRow({
      ...r,
      confidence: r.confidence === "low" ? "low_generated" : r.confidence,
    }),
  );

  const sortedAggressiveBatches = Array.from(byBatchAggressive.keys()).sort((a, b) => Number(a) - Number(b));
  for (const batch of sortedAggressiveBatches) {
    const rowsBatch = byBatchAggressive.get(batch) || [];
    const ws = aggressiveWb.addWorksheet(`BEN${batch}`);
    ws.columns = readyAll.columns;
    rowsBatch.forEach((r) =>
      ws.addRow({
        ...r,
        confidence: r.confidence === "low" ? "low_generated" : r.confidence,
      }),
    );

    const wbBatch = new ExcelJS.Workbook();
    const s = wbBatch.addWorksheet("aggressive");
    s.columns = readyAll.columns;
    rowsBatch.forEach((r) =>
      s.addRow({
        ...r,
        confidence: r.confidence === "low" ? "low_generated" : r.confidence,
      }),
    );
    const batchFile = path.join(outDir, `ملحق_${batch}_جريء_مع_توليد_ترقيم.xlsx`);
    await wbBatch.xlsx.writeFile(batchFile);
  }

  const aggressiveAllPath = path.join(outDir, "ملاحق_الوحدة_جريء_مع_توليد_ترقيم.xlsx");
  await aggressiveWb.xlsx.writeFile(aggressiveAllPath);

  // ملخص
  const summaryWb = new ExcelJS.Workbook();
  const summaryWs = summaryWb.addWorksheet("summary");
  summaryWs.columns = [
    { header: "المؤشر", key: "metric", width: 40 },
    { header: "القيمة", key: "value", width: 20 },
  ];
  summaryWs.addRows([
    { metric: "إجمالي السجلات بعد إزالة التكرار", value: rows.length },
    { metric: "جاهز للاستيراد (ثقة عالية/متوسطة)", value: readyRows.length },
    { metric: "يحتاج مراجعة", value: reviewRows.length },
    { metric: "النسخة الجريئة (صالح بطاقة + يشمل التوليد)", value: aggressiveRows.length },
    { metric: "عدد الدفعات المفصولة", value: sortedBatches.length },
  ]);

  for (const batch of sortedBatches) {
    summaryWs.addRow({
      metric: `دفعة ${batch} - عدد السجلات الجاهزة`,
      value: (byBatch.get(batch) || []).length,
    });
  }

  const methodCounts = resolved.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1;
    return acc;
  }, {});
  summaryWs.addRow({ metric: "", value: "" });
  summaryWs.addRow({ metric: "توزيع طرق التحديد", value: "" });
  for (const [method, count] of Object.entries(methodCounts)) {
    summaryWs.addRow({ metric: method, value: count });
  }

  const summaryPath = path.join(outDir, "ملخص_فصل_ملاحق_الوحدة.xlsx");
  await summaryWb.xlsx.writeFile(summaryPath);

  console.log(`SOURCE=${sourcePath}`);
  console.log(`OUT_DIR=${outDir}`);
  console.log(`TOTAL_ROWS=${rows.length}`);
  console.log(`READY_ROWS=${readyRows.length}`);
  console.log(`REVIEW_ROWS=${reviewRows.length}`);
  console.log(`BATCHES=${sortedBatches.join(",")}`);
  console.log(`READY_ALL=${readyAllPath}`);
  console.log(`REVIEW_FILE=${reviewPath}`);
  console.log(`AGGRESSIVE_ALL=${aggressiveAllPath}`);
  console.log(`SUMMARY_FILE=${summaryPath}`);
}

main().catch((err) => {
  console.error("SPLIT_WAHDA_ANNEXES_FAILED:", err?.message || err);
  process.exit(1);
});
