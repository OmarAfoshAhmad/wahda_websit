const ExcelJS = require("exceljs");
const path = require("path");

async function inspect(fileName) {
  const filePath = path.join(__dirname, "..", "اسماء شركات الاسنان جاهزة للاستيراد", fileName);
  console.log(`\n=== Inspecting Beneficiary File: ${fileName} ===`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];

  const headers = [];
  const rows = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, (c) => headers.push(c.value));
      return;
    }
    if (rows.length < 5) {
      const rowData = [];
      row.eachCell({ includeEmpty: true }, (c) => rowData.push(c.value));
      rows.push(rowData);
    }
  });

  console.log("Headers:", headers);
  console.log("Sample Rows (First 5):");
  rows.forEach((r, idx) => console.log(`Row ${idx + 2}:`, r));
}

async function run() {
  await inspect("Jamarek_List_Import.xlsx");
  await inspect("Cement_List_Import.xlsx");
}

run().catch(console.error);
