const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const DEFAULT_SOURCE = "C:/Users/Omar/Desktop/شركة وعد/دفعات مجمعة.xlsx";

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const HEADER_KEYS = {
  name: ["الاسم", "الأسم", "اسم", "اسم المستفيد", "المستفيد", "name", "beneficiary_name"],
  birth: ["تاريخ الميلاد", "تاريخ الملاد", "الميلاد", "المواليد", "birth", "dob", "birth_date"],
  relation: ["المستفيد", "صلة القرابة", "القرابة", "relationship", "relation", "status"],
  emp: ["رقم الوظيفي", "الرقم الوظيفي", "رقم وظيفي", "employee", "emp", "employee_number", "empno"],
  familyMarker: ["ع.م", "ع,م", "ر.م", "رم", "fm", "family", "family no", "family index"],
  generatedCard: ["الترقيم_المقترح_من_نفس_الملف"],
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

function toAsciiDigits(value) {
  return String(value ?? "").replace(/[٠-٩۰-۹]/g, (ch) => {
    const i1 = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (i1 >= 0) return String(i1);
    const i2 = EASTERN_ARABIC_DIGITS.indexOf(ch);
    if (i2 >= 0) return String(i2);
    return ch;
  });
}

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
  return toAsciiDigits(toCellText(value))
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s_.]/gu, "")
    .trim();
}

function normalizeName(value) {
  return toAsciiDigits(toCellText(value))
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeFlatText(value) {
  return toAsciiDigits(toCellText(value))
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

function parseDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const s = toAsciiDigits(toCellText(value));
  if (!s) return "";

  const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${String(ymd[2]).padStart(2, "0")}-${String(ymd[3]).padStart(2, "0")}`;

  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    let year = String(dmy[3]);
    if (year.length === 2) year = Number(year) > 30 ? `19${year}` : `20${year}`;

    let day = a;
    let month = b;
    if (a <= 12 && b > 12) {
      month = a;
      day = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function normalizeCard(value) {
  const raw = toAsciiDigits(toCellText(value)).toUpperCase().replace(/[\s\-_]+/g, "");
  if (!raw) return "";
  const m = raw.match(/^WAB20250*([0-9]+)([A-Z][0-9]*)?$/);
  if (!m) return "";
  const digits = (m[1] || "").replace(/^0+/, "") || "0";
  const suffix = (m[2] || "").toUpperCase();
  return `WAB2025${digits}${suffix}`;
}

function parseCardInfo(value) {
  const card = normalizeCard(value);
  if (!card) return null;
  const m = card.match(/^WAB2025([0-9]+)([A-Z][0-9]*)?$/);
  if (!m) return null;
  return {
    card,
    baseDigits: m[1],
    suffix: (m[2] || "").toUpperCase(),
  };
}

function parseSuffix(suffix) {
  const s = String(suffix || "").toUpperCase();
  if (!s) return { code: "", index: null };
  const m = s.match(/^([A-Z])([0-9]*)$/);
  if (!m) return { code: "?", index: null };
  return { code: m[1], index: m[2] ? Number(m[2]) : null };
}

function isEmployeeRelation(value) {
  const r = normalizeFlatText(value);
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
  const r = normalizeFlatText(value);
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

function hashText(value) {
  const s = String(value || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
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

function extractBatchFromSheetName(name) {
  const s = toAsciiDigits(String(name ?? "").trim());
  if (!s) return "";
  const direct = s.match(/^([0-9]{1,3})$/);
  if (direct) return String(Number(direct[1]));

  const byWord = s.match(/دفع[هة]\s*([0-9]{1,3})/i);
  if (byWord) return String(Number(byWord[1]));
  return "";
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    source: DEFAULT_SOURCE,
    outDir: "",
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--source") opts.source = args[++i] || opts.source;
    else if (a === "--out-dir") opts.outDir = args[++i] || "";
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const sourcePath = path.resolve(opts.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`ملف غير موجود: ${sourcePath}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = opts.outDir
    ? path.resolve(opts.outDir)
    : path.resolve(process.cwd(), "exports", `truth_registry_batch_import_${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sourcePath);

  const summary = [];
  let totalExported = 0;

  for (const ws of wb.worksheets) {
    const batch = extractBatchFromSheetName(ws.name);
    if (!batch) continue;

    const headerRow = ws.getRow(1);
    const headers = [];
    for (let c = 1; c <= Math.max(ws.columnCount, 30); c += 1) {
      headers.push(toCellText(headerRow.getCell(c).value));
    }

    const nameCol = findColIndex(headers, HEADER_KEYS.name);
    const birthCol = findColIndex(headers, HEADER_KEYS.birth);
    const relationCol = findColIndex(headers, HEADER_KEYS.relation);
    const empCol = findColIndex(headers, HEADER_KEYS.emp);
    const markerCol = findColIndex(headers, HEADER_KEYS.familyMarker);
    const generatedCardCol = findColIndex(headers, HEADER_KEYS.generatedCard);
    const cardCol = findColIndex(headers, HEADER_KEYS.card);

    if (!nameCol || (!generatedCardCol && !cardCol)) {
      continue;
    }

    const rows = [];
    const dedupe = new Set();
    let skippedNoCard = 0;
    let fixedConflicts = 0;

    const families = [];
    let currentFamily = null;
    let familySeq = 0;

    for (let r = 2; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      const name = toCellText(row.getCell(nameCol).value);
      if (!name) continue;

      const relation = relationCol ? toCellText(row.getCell(relationCol).value) : "";
      const birthDate = birthCol ? parseDate(row.getCell(birthCol).value) : "";
      const emp = empCol ? toAsciiDigits(toCellText(row.getCell(empCol).value)).replace(/[^\d]/g, "") : "";
      const marker = markerCol ? toCellText(row.getCell(markerCol).value) : "";

      const cardGenerated = generatedCardCol ? parseCardInfo(row.getCell(generatedCardCol).value) : null;
      const cardRaw = cardCol ? parseCardInfo(row.getCell(cardCol).value) : null;
      const existing = cardGenerated || cardRaw;

      const startNewByMarker = marker !== "" && (!currentFamily || currentFamily.marker !== marker);
      const startNewByEmp = emp !== "" && (!currentFamily || currentFamily.emp !== emp);
      if (!currentFamily || startNewByMarker || startNewByEmp) {
        familySeq += 1;
        currentFamily = { id: `F-${familySeq}`, emp: emp || "", marker: marker || "", members: [] };
        families.push(currentFamily);
      }
      if (!currentFamily.emp && emp) currentFamily.emp = emp;

      currentFamily.members.push({
        rowNumber: r,
        name,
        nameNorm: normalizeName(name),
        relation,
        relationCode: relationCode(relation),
        isEmployee: isEmployeeRelation(relation),
        birthDate,
        emp,
        existingCard: existing?.card || "",
        existingBaseDigits: existing?.baseDigits || "",
        existingSuffix: existing?.suffix || "",
      });
    }

    for (const family of families) {
      if (!family.members.length) continue;

      let baseDigits = family.emp;
      if (!baseDigits) {
        const cnt = new Map();
        for (const m of family.members) {
          if (!m.existingBaseDigits) continue;
          cnt.set(m.existingBaseDigits, (cnt.get(m.existingBaseDigits) || 0) + 1);
        }
        let bestCount = -1;
        for (const [digits, count] of cnt.entries()) {
          if (count > bestCount) {
            bestCount = count;
            baseDigits = digits;
          }
        }
      }

      if (!baseDigits) {
        for (const m of family.members) {
          if (!m.existingCard) skippedNoCard += 1;
        }
        continue;
      }

      const assignedByRow = new Map();
      const usedCards = new Set();

      const sortByBirthThenTie = (a, b) => {
        const da = a.birthDate || "9999-12-31";
        const db = b.birthDate || "9999-12-31";
        if (da < db) return -1;
        if (da > db) return 1;
        const ha = hashText(`${a.nameNorm}|${a.rowNumber}|${family.id}`);
        const hb = hashText(`${b.nameNorm}|${b.rowNumber}|${family.id}`);
        if (ha !== hb) return ha - hb;
        return a.rowNumber - b.rowNumber;
      };

      const mainCandidates = family.members
        .filter((m) => m.isEmployee || m.relationCode === "" || parseSuffix(m.existingSuffix).code === "")
        .sort(sortByBirthThenTie);
      const main = mainCandidates[0] || family.members.slice().sort(sortByBirthThenTie)[0];
      if (main) {
        const mainCard = `WAB2025${baseDigits}`;
        assignedByRow.set(main.rowNumber, mainCard);
        usedCards.add(mainCard);
        if (main.existingCard && main.existingCard !== mainCard) fixedConflicts += 1;
      }

      const codeGroups = new Map();
      for (const m of family.members) {
        if (main && m.rowNumber === main.rowNumber) continue;
        const parsed = parseSuffix(m.existingSuffix);
        const effectiveCode = m.relationCode || (parsed.code && parsed.code !== "?" ? parsed.code : "");
        if (!effectiveCode) continue;
        if (!codeGroups.has(effectiveCode)) codeGroups.set(effectiveCode, []);
        codeGroups.get(effectiveCode).push(m);
      }

      const preferredOrder = ["F", "M", "W", "S", "D", "B"];
      const allCodes = Array.from(codeGroups.keys()).sort((a, b) => {
        const ia = preferredOrder.indexOf(a);
        const ib = preferredOrder.indexOf(b);
        const va = ia >= 0 ? ia : 999;
        const vb = ib >= 0 ? ib : 999;
        if (va !== vb) return va - vb;
        return a.localeCompare(b);
      });

      for (const code of allCodes) {
        const members = codeGroups.get(code) || [];
        members.sort(sortByBirthThenTie);
        let idx = 1;
        for (const m of members) {
          let candidate = `WAB2025${baseDigits}${code}${idx}`;
          while (usedCards.has(candidate)) {
            idx += 1;
            candidate = `WAB2025${baseDigits}${code}${idx}`;
          }
          assignedByRow.set(m.rowNumber, candidate);
          usedCards.add(candidate);
          if (m.existingCard && m.existingCard !== candidate) fixedConflicts += 1;
          idx += 1;
        }
      }

      for (const m of family.members) {
        if (assignedByRow.has(m.rowNumber)) continue;
        if (m.existingCard && !usedCards.has(m.existingCard)) {
          assignedByRow.set(m.rowNumber, m.existingCard);
          usedCards.add(m.existingCard);
        } else {
          skippedNoCard += 1;
        }
      }

      for (const m of family.members) {
        const card = assignedByRow.get(m.rowNumber);
        if (!card) continue;
        const key = `${card}::${m.nameNorm}::${m.birthDate || ""}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        rows.push({
          card_number: card,
          beneficiary_name: m.name,
          birth_date: m.birthDate || "",
          relation: m.relation || "",
          employee_number: m.emp || "",
        });
      }
    }

    // طبقة أمان أخيرة: منع أي ترميز مكرر داخل نفس ملف الدفعة
    // حتى إذا وُجد رقم وظيفي مكرر لعائلتين مختلفتين في المصدر.
    {
      const usedCards = new Set();
      let dedupFixes = 0;
      for (const row of rows) {
        const current = normalizeCard(row.card_number);
        if (!current) continue;
        if (!usedCards.has(current)) {
          row.card_number = current;
          usedCards.add(current);
          continue;
        }

        const info = parseCardInfo(current);
        if (!info) continue;
        let code = relationCode(row.relation);
        if (!code) {
          const suffixInfo = parseSuffix(info.suffix);
          code = suffixInfo.code && suffixInfo.code !== "?" ? suffixInfo.code : "X";
        }
        if (!code) code = "X";

        let idx = 1;
        let candidate = `WAB2025${info.baseDigits}${code}${idx}`;
        while (usedCards.has(candidate)) {
          idx += 1;
          candidate = `WAB2025${info.baseDigits}${code}${idx}`;
        }
        row.card_number = candidate;
        usedCards.add(candidate);
        dedupFixes += 1;
      }
      fixedConflicts += dedupFixes;
    }

    if (rows.length === 0) {
      summary.push({
        batch,
        exported: 0,
        skipped_no_card: skippedNoCard,
        file: "",
      });
      continue;
    }

    const outWb = new ExcelJS.Workbook();
    const outWs = outWb.addWorksheet("Import");
    outWs.views = [{ rightToLeft: true }];
    outWs.columns = [
      { header: "رقم البطاقة", key: "card_number", width: 24 },
      { header: "اسم المستفيد", key: "beneficiary_name", width: 38 },
      { header: "تاريخ الميلاد", key: "birth_date", width: 16 },
      { header: "المستفيد", key: "relation", width: 14 },
      { header: "رقم الوظيفي", key: "employee_number", width: 16 },
    ];

    const header = outWs.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    header.alignment = { vertical: "middle", horizontal: "center" };

    rows.forEach((item) => outWs.addRow(item));
    outWs.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: outWs.columns.length },
    };

    const outFileName = `دفعة_${batch}_جاهزة_لاستيراد_جدول_الحقيقة.xlsx`;
    const outPath = path.join(outDir, outFileName);
    await outWb.xlsx.writeFile(outPath);

    totalExported += rows.length;
    summary.push({
      batch,
      exported: rows.length,
      skipped_no_card: skippedNoCard,
      fixed_conflicts: fixedConflicts,
      file: outPath,
    });
    console.log(
      `[done] batch=${batch} rows=${rows.length} skipped_no_card=${skippedNoCard} fixed_conflicts=${fixedConflicts}`,
    );
  }

  const summaryWb = new ExcelJS.Workbook();
  const summaryWs = summaryWb.addWorksheet("summary");
  summaryWs.views = [{ rightToLeft: true }];
  summaryWs.columns = [
    { header: "الدفعة", key: "batch", width: 12 },
    { header: "سجلات مصدّرة", key: "exported", width: 16 },
    { header: "تخطي بدون ترقيم", key: "skipped_no_card", width: 18 },
    { header: "تصحيحات تضارب ترميز", key: "fixed_conflicts", width: 20 },
    { header: "الملف", key: "file", width: 72 },
  ];
  const sHeader = summaryWs.getRow(1);
  sHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  sHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  summary.forEach((row) => summaryWs.addRow(row));
  summaryWs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: summaryWs.columns.length },
  };
  const summaryPath = path.join(outDir, "ملخص_ملفات_الدفعات_لجدول_الحقيقة.xlsx");
  await summaryWb.xlsx.writeFile(summaryPath);

  const readmePath = path.join(outDir, "README.txt");
  fs.writeFileSync(
    readmePath,
    [
      `المصدر: ${sourcePath}`,
      `الإخراج: ${outDir}`,
      `عدد الدفعات المنتجة: ${summary.filter((s) => s.exported > 0).length}`,
      `إجمالي السجلات المصدرة: ${totalExported}`,
      "",
      "ملاحظات:",
      "- تم الاعتماد أولاً على عمود: الترقيم_المقترح_من_نفس_الملف.",
      "- تمت إعادة ترتيب أفراد العائلة حسب تاريخ الميلاد لكل صلة (F/M/W/S/D/B).",
      "- عند تساوي الميلاد، تم كسر التعادل بمفتاح شبه عشوائي ثابت لتجنب تضارب الترقيم.",
      "- لا يُسمح بتكرار نفس الترميز داخل العائلة نهائيًا.",
      "- عند غياب الترقيم المقترح، تم استخدام رقم البطاقة الأصلي فقط إذا لم يسبب تعارضًا.",
      "- تم تصدير ملفات مستقلة لكل دفعة باسم يحتوي رقم الدفعة ليلتقطه الاستيراد تلقائياً.",
      "- لا يتم إضافة أي أشخاص جدد؛ فقط تصدير الموجود في الملف المجمّع.",
    ].join("\n"),
    "utf8",
  );

  console.log(`[summary] ${summaryPath}`);
  console.log(`[summary] ${readmePath}`);
  console.log("[ok] DONE");
}

main().catch((err) => {
  console.error("[error]", err?.message || err);
  process.exitCode = 1;
});
