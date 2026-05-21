const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
  const filePath = 'c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان جاهزة للاستيراد/Future_List_Import.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(1);
  console.log(`Sheet name: ${ws.name}, Rows: ${ws.rowCount}`);
  
  for (let i = 1; i <= 5; i++) {
    console.log(`Row ${i}:`, JSON.stringify(ws.getRow(i).values));
  }
}

main().catch(console.error);
