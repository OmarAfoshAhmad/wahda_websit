const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const DEFAULT_ROOT = "C:/Users/Omar/Desktop/التحقق من البطاقات الغير مصدرة";

const CITY_SOURCES = [
  { city: "بنغازي", folderCandidates: ["Benghazi", "benghazi"] },
  { city: "طرابلس", folderCandidates: ["Tripoli", "tripoli"] },
];

const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const HEADER_KEYS = {
  card: [
    "رقم البطاقة",
    "رقم_البطاقة",
    "الباركود",
    "barcode",
    "ترقيم المستفيد",
    "البطاقة",
    "card",
    "card number",
    "card_number",
    "insurance profile",
    "insurance_profile",
    "insuranceprofile",
  ],
  name: [
    "الاسم",
    "اسم المستفيد",
    "المستفيد",
    "name",
    "beneficiary",
    "beneficiary name",
    "beneficiary_name",
  ],
  birthDate: [
    "المواليد",
    "تاريخ الميلاد",
    "الميلاد",
    "birth",
    "birth date",
    "birth_date",
    "dob",
  ],
  batch: [
    "الدفعة",
    "رقم الدفعة",
    "batch",
    "batch number",
    "batch_number",
    "batch no",
    "batch_no",
  ],
};

function toAsciiDigits(value) {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => {
    const idxArabicIndic = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (idxArabicIndic >= 0) return String(idxArabicIndic);
    const idxEasternArabic = EASTERN_ARABIC_DIGITS.indexOf(ch);
    if (idxEasternArabic >= 0) return String(idxEasternArabic);
    return ch;
  });
}

function normalizeCard(value) {
  const v = String(value ?? "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim()
    .toUpperCase();
  return toAsciiDigits(v);
}

function compactCard(value) {
  return normalizeCard(value).replace(/[\s\-_]+/g, "");
}

function parseRealCard(value) {
  const compact = compactCard(value);
  if (!compact) return null;
  // In this system the real card identifier is expected to be WAB2025...
  if (!compact.startsWith("WAB2025")) return null;
  return compact;
}

function canonicalizeCard(value) {
  const c = normalizeCard(value);
  const m = c.match(/^WAB2025(\d+)([A-Z0-9]*)$/);
  if (!m) return c;
  const normalizedDigits = m[1].replace(/^0+/, "") || "0";
  const suffix = m[2] || "";
  return `WAB2025${normalizedDigits}${suffix}`;
}

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function includesAny(header, keys) {
  const normalized = String(header ?? "").trim().toLowerCase();
  return keys.some((k) => normalized.includes(k));
}

function cellToString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value).trim();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (Array.isArray(value.richText)) {
      return value.richText.map((x) => (typeof x?.text === "string" ? x.text : "")).join("").trim();
    }
    if (value.result != null) return cellToString(value.result);
  }

  return "";
}

function parseBirthDate(value) {
  const isValidYearRange = (dateObj) => {
    const y = dateObj.getUTCFullYear();
    return y >= 1900 && y <= 2100;
  };

  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isValidYearRange(value) ? value : null;
  }

  const text = cellToString(value);
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return isValidYearRange(direct) ? direct : null;
  }

  return null;
}

function extractBatchFromText(text, options = {}) {
  const { allowGenericToken = false } = options;
  const clean = String(text ?? "").trim();
  if (!clean) return null;

  const ar = clean.match(/دفعة\s*([0-9٠-٩۰-۹]+)/i);
  if (ar?.[1]) return normalizeCard(ar[1]);

  const en = clean.match(/batch\s*[-_ ]*([0-9٠-٩۰-۹]+)/i);
  if (en?.[1]) return normalizeCard(en[1]);

  // Common local naming patterns: BEN_11, BEN 11, TRI-13, Tripoli_5
  const cityStyle = clean.match(/(?:^|[^A-Z0-9])(BEN|TRI|BENGHAZI|TRIPOLI)\s*[-_ ]*([0-9٠-٩۰-۹]{1,3})(?:[^0-9٠-٩۰-۹]|$)/i);
  if (cityStyle?.[2]) return normalizeCard(cityStyle[2]);

  // Last-resort fallback for filenames/paths only (not sheet names like "1").
  if (allowGenericToken) {
    const token = clean.match(/(?:^|[^0-9٠-٩۰-۹])([0-9٠-٩۰-۹]{1,3})(?:[^0-9٠-٩۰-۹]|$)/);
    if (token?.[1]) return normalizeCard(token[1]);
  }

  return null;
}

function extractBatchFromFilename(filename) {
  const clean = filename.replace(/\.(xlsx|xlsm|xls)$/i, "");
  return extractBatchFromText(clean, { allowGenericToken: false });
}

function extractBatchFromSheetName(sheetName) {
  return extractBatchFromText(sheetName, { allowGenericToken: false });
}

function extractBatchFromRelativePath(relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  for (const part of parts) {
    const stem = part.replace(/\.[^.]+$/g, "");
    const parsed = extractBatchFromText(stem, { allowGenericToken: false });
    if (parsed) return parsed;
  }

  return null;
}

function isPlaceholderBatch(value) {
  const v = normalizeCard(value);
  if (!v) return true;
  // Treat visual placeholders as empty, e.g. _, -, --, ...
  return /^[._\-/\\]+$/.test(v);
}

function resolveBatchNumber(rawBatch, fallbackBatch) {
  if (!isPlaceholderBatch(rawBatch)) {
    return normalizeCard(rawBatch);
  }
  if (!isPlaceholderBatch(fallbackBatch)) {
    return normalizeCard(fallbackBatch);
  }
  return null;
}

async function dirExists(dirPath) {
  try {
    const st = await fs.stat(dirPath);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function collectExcelFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectExcelFiles(absPath)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (/\.(xlsx|xlsm)$/i.test(entry.name) && !entry.name.startsWith("~$")) {
      files.push(absPath);
    }
  }

  return files;
}

async function resolveCityFolders(rootDir) {
  const resolved = [];
  const missing = [];

  for (const item of CITY_SOURCES) {
    let found = null;
    for (const candidate of item.folderCandidates) {
      const p = path.join(rootDir, candidate);
      if (await dirExists(p)) {
        found = p;
        break;
      }
    }

    if (found) {
      resolved.push({ city: item.city, folderPath: found });
    } else {
      missing.push(item.folderCandidates[0]);
    }
  }

  return { resolved, missing };
}

function findHeaderColumns(ws) {
  const scanRows = Math.min(ws.rowCount, 30);

  for (let r = 1; r <= scanRows; r += 1) {
    const values = ws.getRow(r).values;
    const cells = values.slice(1).map((v) => cellToString(v));
    if (cells.length === 0) continue;

    const cardCandidates = [];
    let nameCol = -1;
    let birthCol = -1;
    let batchCol = -1;

    for (let i = 0; i < cells.length; i += 1) {
      const h = cells[i];
      if (includesAny(h, HEADER_KEYS.card)) cardCandidates.push(i + 1);
      if (nameCol < 0 && includesAny(h, HEADER_KEYS.name)) nameCol = i + 1;
      if (birthCol < 0 && includesAny(h, HEADER_KEYS.birthDate)) birthCol = i + 1;
      if (batchCol < 0 && includesAny(h, HEADER_KEYS.batch)) batchCol = i + 1;
    }

    if (cardCandidates.length > 0) {
      let cardCol = cardCandidates[0];
      let bestScore = -1;

      // Pick the candidate column that actually contains WAB2025 card values.
      const maxDataRows = Math.min(ws.rowCount, r + 120);
      for (const candidateCol of cardCandidates) {
        let score = 0;
        for (let rr = r + 1; rr <= maxDataRows; rr += 1) {
          const sample = cellToString(ws.getRow(rr).getCell(candidateCol).value);
          if (parseRealCard(sample)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          cardCol = candidateCol;
        }
      }

      // If none of the candidate columns contains real card values, skip this sheet.
      if (bestScore <= 0) continue;

      return {
        headerRow: r,
        cardCol,
        nameCol,
        birthCol,
        batchCol,
      };
    }
  }

  return null;
}

function scoreRow(row) {
  let s = 0;
  if (row.batch_number) s += 5;
  if (row.birth_date) s += 3;
  if (row.beneficiary_name) s += 2;
  return s;
}

function dedupeRows(rows) {
  const byCard = new Map();

  for (const row of rows) {
    const current = byCard.get(row.card_number_upper);
    if (!current) {
      byCard.set(row.card_number_upper, row);
      continue;
    }

    const currentScore = scoreRow(current);
    const nextScore = scoreRow(row);

    if (nextScore > currentScore) {
      byCard.set(row.card_number_upper, row);
      continue;
    }

    if (nextScore === currentScore && row.source_file < current.source_file) {
      byCard.set(row.card_number_upper, row);
    }
  }

  return Array.from(byCard.values());
}

async function extractMergedRows(rootDir) {
  const { resolved, missing } = await resolveCityFolders(rootDir);
  const merged = [];
  const discoveredBatchesByCity = {};

  for (const folder of resolved) {
    const discovered = new Set();
    const cityEntries = await fs.readdir(folder.folderPath, { withFileTypes: true });
    for (const entry of cityEntries) {
      const parsed = extractBatchFromText(entry.name, { allowGenericToken: false });
      if (parsed) discovered.add(parsed);
    }

    const files = await collectExcelFiles(folder.folderPath);

    for (const filePath of files) {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.readFile(filePath);
      } catch {
        continue;
      }

      for (const ws of wb.worksheets) {
        const header = findHeaderColumns(ws);
        if (!header) continue;

        const relativeSource = path.relative(rootDir, filePath).replace(/\\/g, "/");
        const pathFallbackBatch = extractBatchFromRelativePath(relativeSource);
        const fileFallbackBatch = extractBatchFromFilename(path.basename(filePath));
        const sheetFallbackBatch = extractBatchFromSheetName(ws.name);
        // Prefer folder/file derived batch; sheet name is only a weak fallback.
        const fallbackBatch = pathFallbackBatch || fileFallbackBatch || sheetFallbackBatch;
        if (fallbackBatch) discovered.add(fallbackBatch);

        for (let r = header.headerRow + 1; r <= ws.rowCount; r += 1) {
          const row = ws.getRow(r);

          const cardRaw = cellToString(row.getCell(header.cardCol).value);
          const card = parseRealCard(cardRaw);
          if (!card) continue;

          const nameRaw = header.nameCol > 0 ? cellToString(row.getCell(header.nameCol).value) : "";
          const batchRaw = header.batchCol > 0 ? cellToString(row.getCell(header.batchCol).value) : "";
          const birthRaw = header.birthCol > 0 ? row.getCell(header.birthCol).value : null;

          const batchFromRow = resolveBatchNumber(batchRaw, null);
          const chosenBatch = fallbackBatch || batchFromRow;

          merged.push({
            id: crypto.randomUUID(),
            card_number: card,
            card_number_upper: card,
            canonical_card: canonicalizeCard(card),
            beneficiary_name: normalizeName(nameRaw) || null,
            birth_date: parseBirthDate(birthRaw),
            batch_number: chosenBatch,
            city: folder.city,
            source_file: relativeSource,
            source_sheet: ws.name || null,
            source_row: r,
          });
        }
      }
    }

    const sortedDiscovered = Array.from(discovered).sort((a, b) => {
      const na = Number.parseInt(a, 10);
      const nb = Number.parseInt(b, 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      if (Number.isFinite(na)) return -1;
      if (Number.isFinite(nb)) return 1;
      return a.localeCompare(b, "ar");
    });
    discoveredBatchesByCity[folder.city] = sortedDiscovered;
  }

  return { rawRows: merged, rows: dedupeRows(merged), missing, discoveredBatchesByCity };
}

async function ensureTableExists() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CardIssuanceRegistry" (
      "id" TEXT NOT NULL,
      "card_number" TEXT NOT NULL,
      "card_number_upper" TEXT NOT NULL,
      "canonical_card" TEXT NOT NULL,
      "beneficiary_name" TEXT,
      "birth_date" TIMESTAMP(3),
      "batch_number" TEXT,
      "city" TEXT NOT NULL,
      "source_file" TEXT,
      "source_sheet" TEXT,
      "source_row" INTEGER,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CardIssuanceRegistry_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CardIssuanceRegistry_card_number_upper_key"
    ON "CardIssuanceRegistry" ("card_number_upper")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistry_canonical_card_idx"
    ON "CardIssuanceRegistry" ("canonical_card")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistry_city_idx"
    ON "CardIssuanceRegistry" ("city")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistry_batch_number_idx"
    ON "CardIssuanceRegistry" ("batch_number")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CardIssuanceRegistryAll" (
      "id" TEXT NOT NULL,
      "card_number" TEXT NOT NULL,
      "card_number_upper" TEXT NOT NULL,
      "canonical_card" TEXT NOT NULL,
      "beneficiary_name" TEXT,
      "birth_date" TIMESTAMP(3),
      "batch_number" TEXT,
      "city" TEXT NOT NULL,
      "source_file" TEXT,
      "source_sheet" TEXT,
      "source_row" INTEGER,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CardIssuanceRegistryAll_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistryAll_card_number_upper_idx"
    ON "CardIssuanceRegistryAll" ("card_number_upper")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistryAll_canonical_card_idx"
    ON "CardIssuanceRegistryAll" ("canonical_card")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistryAll_city_idx"
    ON "CardIssuanceRegistryAll" ("city")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistryAll_batch_number_idx"
    ON "CardIssuanceRegistryAll" ("batch_number")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CardIssuanceRegistryAll_norm_name_birth_date_idx"
    ON "CardIssuanceRegistryAll" (
      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\\\s+', ' ', 'g')),
      CAST(birth_date AS date)
    ) WHERE birth_date IS NOT NULL
  `);
}

async function replaceRegistryRows(rows) {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "CardIssuanceRegistry"`);

  for (const row of rows) {
    await prisma.$executeRaw`
      INSERT INTO "CardIssuanceRegistry" (
        "id",
        "card_number",
        "card_number_upper",
        "canonical_card",
        "beneficiary_name",
        "birth_date",
        "batch_number",
        "city",
        "source_file",
        "source_sheet",
        "source_row",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${row.id},
        ${row.card_number},
        ${row.card_number_upper},
        ${row.canonical_card},
        ${row.beneficiary_name},
        ${row.birth_date},
        ${row.batch_number},
        ${row.city},
        ${row.source_file},
        ${row.source_sheet},
        ${row.source_row},
        NOW(),
        NOW()
      )
    `;
  }
}

async function replaceRegistryAllRows(rows) {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "CardIssuanceRegistryAll"`);

  for (const row of rows) {
    await prisma.$executeRaw`
      INSERT INTO "CardIssuanceRegistryAll" (
        "id",
        "card_number",
        "card_number_upper",
        "canonical_card",
        "beneficiary_name",
        "birth_date",
        "batch_number",
        "city",
        "source_file",
        "source_sheet",
        "source_row",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${row.id},
        ${row.card_number},
        ${row.card_number_upper},
        ${row.canonical_card},
        ${row.beneficiary_name},
        ${row.birth_date},
        ${row.batch_number},
        ${row.city},
        ${row.source_file},
        ${row.source_sheet},
        ${row.source_row},
        NOW(),
        NOW()
      )
    `;
  }
}

function countCardsInMultipleBatches(rows) {
  const byCard = new Map();
  for (const row of rows) {
    if (!row.card_number_upper) continue;
    const key = row.card_number_upper;
    const batchValue = row.batch_number && String(row.batch_number).trim() !== "" ? String(row.batch_number) : "__NO_BATCH__";
    if (!byCard.has(key)) byCard.set(key, new Set());
    byCard.get(key).add(batchValue);
  }

  let multiBatchCards = 0;
  for (const batches of byCard.values()) {
    if (batches.size > 1) multiBatchCards += 1;
  }
  return multiBatchCards;
}

function summarizeBatchesByCity(rows) {
  const byCity = new Map();
  for (const row of rows) {
    const city = row.city || "UNKNOWN";
    const batch = row.batch_number && String(row.batch_number).trim() !== "" ? String(row.batch_number) : "بدون دفعة";
    if (!byCity.has(city)) byCity.set(city, new Set());
    byCity.get(city).add(batch);
  }

  const summary = {};
  for (const [city, set] of byCity.entries()) {
    const values = Array.from(set);
    values.sort((a, b) => {
      const na = Number.parseInt(a, 10);
      const nb = Number.parseInt(b, 10);
      const aNum = Number.isFinite(na);
      const bNum = Number.isFinite(nb);
      if (aNum && bNum) return na - nb;
      if (aNum) return -1;
      if (bNum) return 1;
      return a.localeCompare(b, "ar");
    });
    summary[city] = values;
  }

  return summary;
}

async function main() {
  const rootDir = path.resolve(process.argv[2] || process.env.CARD_ISSUANCE_ROOT || DEFAULT_ROOT);

  console.log(`[sync-card-issuance-registry] source root: ${rootDir}`);

  const { rawRows, rows, missing, discoveredBatchesByCity } = await extractMergedRows(rootDir);

  if (missing.length > 0) {
    console.warn(`[sync-card-issuance-registry] missing folders: ${missing.join(", ")}`);
  }

  if (rawRows.length === 0) {
    console.warn("[sync-card-issuance-registry] no rows extracted; table was not changed.");
    return;
  }

  await ensureTableExists();
  await replaceRegistryAllRows(rawRows);
  await replaceRegistryRows(rows);

  const cityCounts = rawRows.reduce((acc, r) => {
    acc[r.city] = (acc[r.city] || 0) + 1;
    return acc;
  }, {});
  const multiBatchCards = countCardsInMultipleBatches(rawRows);
  const batchesByCity = summarizeBatchesByCity(rawRows);

  const missingImportedByCity = {};
  for (const [city, discovered] of Object.entries(discoveredBatchesByCity || {})) {
    const imported = new Set(Array.isArray(batchesByCity[city]) ? batchesByCity[city] : []);
    missingImportedByCity[city] = (discovered || []).filter((b) => !imported.has(b));
  }

  console.log(`[sync-card-issuance-registry] raw rows synced: ${rawRows.length}`);
  console.log(`[sync-card-issuance-registry] deduped rows synced: ${rows.length}`);
  console.log(`[sync-card-issuance-registry] cards in multiple batches: ${multiBatchCards}`);
  console.log(`[sync-card-issuance-registry] raw by city: ${JSON.stringify(cityCounts)}`);
  console.log(`[sync-card-issuance-registry] discovered batches by city: ${JSON.stringify(discoveredBatchesByCity)}`);
  console.log(`[sync-card-issuance-registry] batches by city: ${JSON.stringify(batchesByCity)}`);
  console.log(`[sync-card-issuance-registry] discovered but no imported rows: ${JSON.stringify(missingImportedByCity)}`);
}

main()
  .catch((err) => {
    console.error("[sync-card-issuance-registry] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
