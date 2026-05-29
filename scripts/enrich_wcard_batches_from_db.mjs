import path from "node:path";
import fs from "node:fs";
import xlsx from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const INPUT_PATH =
  process.argv[2] ||
  path.join(process.cwd(), "exports", "wcard_beneficiaries_organized.xlsx");
const OUTPUT_PATH =
  process.argv[3] ||
  path.join(process.cwd(), "exports", "wcard_beneficiaries_organized_db_enriched.xlsx");

function normalizeText(v) {
  const s = String(v ?? "").trim();
  return s.toLowerCase() === "nan" ? "" : s;
}

function normalizeDigits(v) {
  return normalizeText(v).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function normalizeEmployeeNumber(v) {
  let s = normalizeDigits(v);
  if (!s) return "";
  s = s.replace(/[, ]/g, "");
  if (/^\d+\.0+$/.test(s)) s = s.split(".")[0];
  if (!/^\d{2,12}$/.test(s)) return "";
  return s;
}

function toCardUpper(v) {
  return normalizeText(v).toUpperCase().replace(/\s+/g, "");
}

function canonicalizeCard(v) {
  const upper = toCardUpper(v);
  if (!upper) return "";
  return upper.replace(/^WAB20250*([1-9][0-9]*|0)/, "WAB2025$1");
}

function chunk(arr, size = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function makeCountMap() {
  return new Map();
}

function putCount(map, key, batch) {
  if (!key || !batch) return;
  const normalizedBatch = normalizeDigits(batch);
  if (!normalizedBatch) return;
  if (!map.has(key)) map.set(key, new Map());
  const bucket = map.get(key);
  bucket.set(normalizedBatch, (bucket.get(normalizedBatch) || 0) + 1);
}

function finalizeCountMap(map) {
  const out = new Map();
  for (const [key, bucket] of map.entries()) {
    const sorted = [...bucket.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return Number(a[0]) - Number(b[0]);
    });
    if (sorted.length > 0) out.set(key, sorted[0][0]);
  }
  return out;
}

async function buildDbMaps({ unresolvedCardsUpper, unresolvedCardsCanonical, unresolvedJobs, unresolvedNames }) {
  const registryAllByUpperRaw = makeCountMap();
  const registryAllByCanonicalRaw = makeCountMap();
  const registryByUpperRaw = makeCountMap();
  const registryByCanonicalRaw = makeCountMap();
  const archiveByCardUpperRaw = makeCountMap();
  const archiveByJobRaw = makeCountMap();
  const archiveByNameRaw = makeCountMap();

  for (const upperChunk of chunk(unresolvedCardsUpper, 500)) {
    const rows = await prisma.cardIssuanceRegistryAll.findMany({
      where: { card_number_upper: { in: upperChunk } },
      select: {
        card_number_upper: true,
        canonical_card: true,
        batch_number: true,
      },
    });
    for (const r of rows) {
      putCount(registryAllByUpperRaw, toCardUpper(r.card_number_upper), r.batch_number);
      putCount(registryAllByCanonicalRaw, canonicalizeCard(r.canonical_card), r.batch_number);
    }
  }

  for (const canonicalChunk of chunk(unresolvedCardsCanonical, 500)) {
    const rows = await prisma.cardIssuanceRegistryAll.findMany({
      where: { canonical_card: { in: canonicalChunk } },
      select: {
        card_number_upper: true,
        canonical_card: true,
        batch_number: true,
      },
    });
    for (const r of rows) {
      putCount(registryAllByUpperRaw, toCardUpper(r.card_number_upper), r.batch_number);
      putCount(registryAllByCanonicalRaw, canonicalizeCard(r.canonical_card), r.batch_number);
    }
  }

  for (const upperChunk of chunk(unresolvedCardsUpper, 500)) {
    const rows = await prisma.cardIssuanceRegistry.findMany({
      where: { card_number_upper: { in: upperChunk } },
      select: {
        card_number_upper: true,
        canonical_card: true,
        batch_number: true,
      },
    });
    for (const r of rows) {
      putCount(registryByUpperRaw, toCardUpper(r.card_number_upper), r.batch_number);
      putCount(registryByCanonicalRaw, canonicalizeCard(r.canonical_card), r.batch_number);
    }
  }

  for (const canonicalChunk of chunk(unresolvedCardsCanonical, 500)) {
    const rows = await prisma.cardIssuanceRegistry.findMany({
      where: { canonical_card: { in: canonicalChunk } },
      select: {
        card_number_upper: true,
        canonical_card: true,
        batch_number: true,
      },
    });
    for (const r of rows) {
      putCount(registryByUpperRaw, toCardUpper(r.card_number_upper), r.batch_number);
      putCount(registryByCanonicalRaw, canonicalizeCard(r.canonical_card), r.batch_number);
    }
  }

  for (const cardChunk of chunk(unresolvedCardsUpper, 500)) {
    const rows = await prisma.cardNumberingArchive.findMany({
      where: {
        card_number: { in: cardChunk },
        deleted_at: null,
        batch_number: { not: null },
      },
      select: {
        card_number: true,
        batch_number: true,
      },
    });
    for (const r of rows) {
      putCount(archiveByCardUpperRaw, toCardUpper(r.card_number), r.batch_number);
    }
  }

  for (const jobChunk of chunk(unresolvedJobs, 500)) {
    const rows = await prisma.cardNumberingArchive.findMany({
      where: {
        employee_number: { in: jobChunk },
        deleted_at: null,
        batch_number: { not: null },
      },
      select: {
        employee_number: true,
        batch_number: true,
      },
    });
    for (const r of rows) {
      putCount(archiveByJobRaw, normalizeEmployeeNumber(r.employee_number), r.batch_number);
    }
  }

  for (const nameChunk of chunk(unresolvedNames, 300)) {
    const rows = await prisma.cardNumberingArchive.findMany({
      where: {
        name: { in: nameChunk },
        deleted_at: null,
        batch_number: { not: null },
      },
      select: {
        name: true,
        batch_number: true,
      },
    });
    for (const r of rows) {
      putCount(archiveByNameRaw, normalizeText(r.name), r.batch_number);
    }
  }

  return {
    registryAllByUpper: finalizeCountMap(registryAllByUpperRaw),
    registryAllByCanonical: finalizeCountMap(registryAllByCanonicalRaw),
    registryByUpper: finalizeCountMap(registryByUpperRaw),
    registryByCanonical: finalizeCountMap(registryByCanonicalRaw),
    archiveByCardUpper: finalizeCountMap(archiveByCardUpperRaw),
    archiveByJob: finalizeCountMap(archiveByJobRaw),
    archiveByName: finalizeCountMap(archiveByNameRaw),
  };
}

function pickBatchFromDb(row, maps) {
  const cardUpper = toCardUpper(row["رقم_البطاقة"]);
  const cardCanonical = canonicalizeCard(cardUpper);
  const job = normalizeEmployeeNumber(row["الرقم_الوظيفي"]);
  const name = normalizeText(row["الاسم"]);

  const candidates = [
    { source: "registry_all_card_upper", batch: maps.registryAllByUpper.get(cardUpper) || "" },
    { source: "registry_all_canonical", batch: maps.registryAllByCanonical.get(cardCanonical) || "" },
    { source: "registry_card_upper", batch: maps.registryByUpper.get(cardUpper) || "" },
    { source: "registry_canonical", batch: maps.registryByCanonical.get(cardCanonical) || "" },
    { source: "archive_card_upper", batch: maps.archiveByCardUpper.get(cardUpper) || "" },
    { source: "archive_employee_number", batch: maps.archiveByJob.get(job) || "" },
    { source: "archive_name_exact", batch: maps.archiveByName.get(name) || "" },
  ];

  const found = candidates.find((c) => normalizeText(c.batch) !== "");
  if (!found) return { batch: "", source: "" };
  return { batch: normalizeDigits(found.batch), source: found.source };
}

function toSheet(data) {
  return xlsx.utils.json_to_sheet(data, { skipHeader: false });
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Input file not found: ${INPUT_PATH}`);
  }

  const wb = xlsx.readFile(INPUT_PATH, { cellDates: true });
  const sheetName = "الملف_الموحد";
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const unifiedRows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const unresolved = unifiedRows.filter((r) => normalizeText(r["الدفعة"]) === "");

  const unresolvedCardsUpper = [
    ...new Set(unresolved.map((r) => toCardUpper(r["رقم_البطاقة"])).filter(Boolean)),
  ];
  const unresolvedCardsCanonical = [
    ...new Set(unresolved.map((r) => canonicalizeCard(r["رقم_البطاقة"])).filter(Boolean)),
  ];
  const unresolvedJobs = [
    ...new Set(unresolved.map((r) => normalizeEmployeeNumber(r["الرقم_الوظيفي"])).filter(Boolean)),
  ];
  const unresolvedNames = [
    ...new Set(unresolved.map((r) => normalizeText(r["الاسم"])).filter(Boolean)),
  ];

  const maps = await buildDbMaps({
    unresolvedCardsUpper,
    unresolvedCardsCanonical,
    unresolvedJobs,
    unresolvedNames,
  });

  let filledFromDb = 0;
  const sourceCount = new Map();

  const enrichedUnified = unifiedRows.map((row) => {
    const currentBatch = normalizeText(row["الدفعة"]);
    if (currentBatch) {
      return {
        ...row,
        الدفعة_من_قاعدة_البيانات: "",
        مصدر_استنتاج_الدفعة_DB: "",
      };
    }

    const picked = pickBatchFromDb(row, maps);
    if (!picked.batch) {
      return {
        ...row,
        الدفعة_من_قاعدة_البيانات: "",
        مصدر_استنتاج_الدفعة_DB: "",
      };
    }

    filledFromDb += 1;
    sourceCount.set(picked.source, (sourceCount.get(picked.source) || 0) + 1);

    return {
      ...row,
      الدفعة: picked.batch,
      الدفعة_من_قاعدة_البيانات: picked.batch,
      مصدر_استنتاج_الدفعة_DB: picked.source,
    };
  });

  const unresolvedAfter = enrichedUnified.filter((r) => normalizeText(r["الدفعة"]) === "");
  const summary = [
    {
      المؤشر: "قبل_الإثراء_بدون_دفعة",
      القيمة: unresolved.length,
    },
    {
      المؤشر: "بعد_الإثراء_بدون_دفعة",
      القيمة: unresolvedAfter.length,
    },
    {
      المؤشر: "تم_تعبئتها_من_DB",
      القيمة: filledFromDb,
    },
  ];

  for (const [src, cnt] of [...sourceCount.entries()].sort((a, b) => b[1] - a[1])) {
    summary.push({ المؤشر: `مصدر_${src}`, القيمة: cnt });
  }

  const enrichedAll = xlsx.utils.sheet_to_json(wb.Sheets["كل_السجلات"], { defval: "" }).map((row) => {
    const keyName = normalizeText(row["الاسم"]);
    const keyJob = normalizeEmployeeNumber(row["الرقم_الوظيفي"]);
    if (normalizeText(row["الدفعة_المعتمدة"])) {
      return row;
    }
    const unifiedMatch = enrichedUnified.find(
      (u) =>
        normalizeText(u["الاسم"]) === keyName &&
        normalizeEmployeeNumber(u["الرقم_الوظيفي"]) === keyJob &&
        normalizeText(u["الدفعة"]) !== "",
    );
    if (!unifiedMatch) return row;
    return {
      ...row,
      الدفعة_المعتمدة: unifiedMatch["الدفعة"],
      الدفعة_من_قاعدة_البيانات: unifiedMatch["الدفعة_من_قاعدة_البيانات"] || "",
      مصدر_استنتاج_الدفعة_DB: unifiedMatch["مصدر_استنتاج_الدفعة_DB"] || "",
    };
  });

  const summaryBatch = (() => {
    const map = new Map();
    for (const row of enrichedUnified) {
      const b = normalizeText(row["الدفعة"]) || "غير معروف";
      map.set(b, (map.get(b) || 0) + 1);
    }
    return [...map.entries()]
      .map(([batch, count]) => ({ الدفعة: batch, عدد_الأسماء: count }))
      .sort((a, b) => String(a.الدفعة).localeCompare(String(b.الدفعة), "ar"));
  })();

  const wbOut = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wbOut, toSheet(enrichedUnified), "الملف_الموحد");
  xlsx.utils.book_append_sheet(wbOut, toSheet(enrichedAll), "كل_السجلات");
  xlsx.utils.book_append_sheet(wbOut, toSheet(summaryBatch), "ملخص_الدفعات");
  xlsx.utils.book_append_sheet(wbOut, toSheet(unresolvedAfter), "بدون_دفعة");
  xlsx.utils.book_append_sheet(wbOut, toSheet(summary), "ملخص_إثراء_DB");

  if (wb.Sheets["ملخص_المصادر"]) {
    const srcRows = xlsx.utils.sheet_to_json(wb.Sheets["ملخص_المصادر"], { defval: "" });
    xlsx.utils.book_append_sheet(wbOut, toSheet(srcRows), "ملخص_المصادر");
  }
  if (wb.Sheets["ملفات_فشل_قراءتها"]) {
    const failedRows = xlsx.utils.sheet_to_json(wb.Sheets["ملفات_فشل_قراءتها"], { defval: "" });
    xlsx.utils.book_append_sheet(wbOut, toSheet(failedRows), "ملفات_فشل_قراءتها");
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  xlsx.writeFile(wbOut, OUTPUT_PATH);

  console.log(`INPUT=${INPUT_PATH}`);
  console.log(`OUTPUT=${OUTPUT_PATH}`);
  console.log(`UNRESOLVED_BEFORE=${unresolved.length}`);
  console.log(`FILLED_FROM_DB=${filledFromDb}`);
  console.log(`UNRESOLVED_AFTER=${unresolvedAfter.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
