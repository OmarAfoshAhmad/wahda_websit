const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

async function checkRows(dir, file) {
  const filePath = path.join("c:/Users/Omar/waad_temp_website", dir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`Not found: ${filePath}`);
    return;
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
  console.log(`- [${dir}] ${file}: Rows = ${ws.rowCount}`);
}

async function main() {
  console.log("=== Checking Row Counts of Excel Files ===");
  await checkRows("حركات الشركات للأسنان", "JMR_Transactions.xlsx");
  await checkRows("حركات الشركات للأسنان", "LCC_Transactions.xlsx");
  await checkRows("اسماء شركات الاسنان جاهزة للاستيراد", "Jamarek_List_Import.xlsx");
  await checkRows("اسماء شركات الاسنان جاهزة للاستيراد", "Cement_List_Import.xlsx");
}

main().catch(console.error);
