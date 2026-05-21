const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان جاهزة للاستيراد/Arcadia_List_Import.xlsx');
  const ws = wb.getWorksheet(1);
  console.log(`Arcadia List Import rows count: ${ws.rowCount}`);
  for (let i = 1; i <= 10; i++) {
    console.log(`Row ${i}:`, JSON.stringify(ws.getRow(i).values));
  }
}

main().catch(console.error);
