const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/MERG ARCADIA/سجل الموظفين اركاديا المدمج.xlsx');
  console.log(`Sheets in Arcadia:`, wb.worksheets.map(w => w.name));
  const ws = wb.getWorksheet(1);
  console.log(`Rows: ${ws.rowCount}`);
  for (let i = 1; i <= 15; i++) {
    console.log(`Row ${i}:`, JSON.stringify(ws.getRow(i).values));
  }
}

main().catch(console.error);
