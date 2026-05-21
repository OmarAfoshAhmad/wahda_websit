const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان جاهزة للاستيراد/Waad_List_Import.xlsx');
  const ws = wb.getWorksheet(1);
  console.log(`Waad List Import rows count: ${ws.rowCount}`);
  for (let i = 1; i <= 20; i++) {
    console.log(`Row ${i}:`, JSON.stringify(ws.getRow(i).values));
  }
}

main().catch(console.error);
