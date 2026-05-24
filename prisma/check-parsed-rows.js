const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

async function checkRows(fileName) {
  const filePath = path.join(__dirname, "..", "اسماء شركات الاسنان جاهزة للاستيراد", fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  console.log(`\n=== File: ${fileName} ===`);
  console.log(`worksheet.rowCount: ${worksheet.rowCount}`);

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

  console.log(`Parsed rows count (API style): ${rows.length}`);
}

async function run() {
  await checkRows("Jamarek_List_Import.xlsx");
  await checkRows("Cement_List_Import.xlsx");
}

run().catch(console.error);
