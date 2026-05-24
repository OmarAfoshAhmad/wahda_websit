const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

// Copy the extraction helper logic from Next.js server route
function normalizeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((r) => String(r.text ?? "")).join("").trim();
    }
    if ("result" in value) return String(value.result ?? "").trim();
    if ("text" in value) return String(value.text ?? "").trim();
    if ("value" in value) return String(value.value ?? "").trim();
    try { return JSON.stringify(value); } catch { return ""; }
  }
  return String(value).trim();
}

function getField(row, ...keys) {
  for (const key of keys) {
    if (key in row) return row[key];
  }
  const trimmedEntries = Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]);
  for (const key of keys) {
    const found = trimmedEntries.find(([k]) => k === key.toLowerCase());
    if (found) return found[1];
  }
  return undefined;
}

async function testImport(fileName, companyId) {
  console.log(`\n=== Testing Import for ${fileName} ===`);
  const filePath = path.join(__dirname, "..", "اسماء شركات الاسنان جاهزة للاستيراد", fileName);
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    while (headers.length < colNumber - 1) headers.push("");
    headers.push(String(cell.value ?? "").trim());
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = { __rowNumber: rowNumber };
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        const v = cell.value;
        obj[header] = v instanceof Date ? v.toISOString() : v;
      }
    });
    if (Object.values(obj).some((v) => v !== null && v !== undefined && v !== "")) {
      rows.push(obj);
    }
  });

  console.log(`Parsed ${rows.length} rows from Excel.`);

  // Let's validate the first few rows
  for (let idx = 0; idx < Math.min(5, rows.length); idx++) {
    const row = rows[idx];
    const cardNumber = normalizeString(getField(row, "card_number", "رقم البطاقة", "رقم_البطاقة", "الرقم", "رقم_بطاقة"));
    const name = normalizeString(getField(row, "name", "الاسم", "الإسم", "اسم المستفيد", "اسم_المستفيد"));
    console.log(`Row ${row.__rowNumber}: Name="${name}", Card="${cardNumber}"`);
  }

  // Now, let's simulate the import logic to see if any rows would be skipped or cause errors,
  // without writing to database.
  const activeCompanies = await prisma.insuranceCompany.findMany({
    where: { is_active: true, deleted_at: null }
  });
  
  const targetCompany = activeCompanies.find(c => c.id === companyId);
  console.log(`Target company: ${targetCompany ? targetCompany.name : "None (Auto-match)"}`);

  const seenCards = new Set();
  let failed = 0;
  let duplicates = 0;
  let valid = 0;

  for (const row of rows) {
    const cardNumber = normalizeString(getField(row, "card_number", "رقم البطاقة", "رقم_البطاقة", "الرقم", "رقم_بطاقة")).toUpperCase();
    const name = normalizeString(getField(row, "name", "الاسم", "الإسم", "اسم المستفيد", "اسم_المستفيد"));

    if (!cardNumber || !name) {
      failed++;
      continue;
    }

    if (seenCards.has(cardNumber)) {
      duplicates++;
      continue;
    }
    seenCards.add(cardNumber);
    valid++;
  }

  console.log(`Validation results:`);
  console.log(`- Valid rows: ${valid}`);
  console.log(`- Duplicate rows in file: ${duplicates}`);
  console.log(`- Missing name/card errors: ${failed}`);
}

async function run() {
  // JMR: cmpgpi50z000uu9h4fh82k1ha
  // LCC: cmpgpi516000xu9h4b2zpk92x
  await testImport("Cement_List_Import.xlsx", "cmpgpi516000xu9h4b2zpk92x");
  await testImport("Jamarek_List_Import.xlsx", "cmpgpi50z000uu9h4fh82k1ha");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
