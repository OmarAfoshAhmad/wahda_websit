const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

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

async function testJob(fileName, companyId) {
  console.log(`\n=== Simulating Job Creation for ${fileName} ===`);
  const filePath = path.join(__dirname, "..", "اسماء شركات الاسنان جاهزة للاستيراد", fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
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

  console.log(`Parsed ${rows.length} rows. Attempting to create ImportJob in DB...`);

  try {
    const job = await prisma.importJob.create({
      data: {
        created_by: "test-script",
        payload: JSON.parse(JSON.stringify(rows)),
        total_rows: rows.length,
        options: { company_id: companyId, reactivate: false, updateBalance: false }
      }
    });
    console.log(`Successfully created import job. ID: ${job.id}`);
    
    // Now let's try calling processImportJob on this job!
    const { processImportJob } = require("../src/lib/import-jobs");
    console.log(`Starting processImportJob in background/foreground...`);
    const result = await processImportJob(job.id, "test-script");
    console.log(`Process result:`, JSON.stringify(result, null, 2));

    // Clean up test job
    await prisma.importJob.delete({ where: { id: job.id } });
    console.log("Deleted test job.");
  } catch (error) {
    console.error("Error creating/running job:", error);
  }
}

async function run() {
  // Let's test with LCC first (smaller file)
  // LCC company ID: cmpgpi516000xu9h4b2zpk92x
  await testJob("Cement_List_Import.xlsx", "cmpgpi516000xu9h4b2zpk92x");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
