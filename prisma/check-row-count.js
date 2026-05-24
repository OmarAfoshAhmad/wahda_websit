const ExcelJS = require("exceljs");
const path = require("path");

async function checkRowCount(fileName) {
  const filePath = path.join(__dirname, "..", "اسماء شركات الاسنان جاهزة للاستيراد", fileName);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
  let count = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nameVal = row.getCell(1).value;
    const cardVal = row.getCell(2).value;
    if (nameVal || cardVal) count++;
  });
  console.log(`${fileName}: ${count} valid rows (Total rows including headers/empty: ${ws.rowCount})`);
}

async function run() {
  await checkRowCount("Jamarek_List_Import.xlsx");
  await checkRowCount("Cement_List_Import.xlsx");
}

run().catch(console.error);
