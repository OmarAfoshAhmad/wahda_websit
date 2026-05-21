const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx');
  console.log(`Sheets:`, wb.worksheets.map(w => w.name));
  const ws = wb.worksheets[0];
  console.log(`Rows: ${ws.rowCount}`);
  for (let i = 1; i <= 10; i++) {
    console.log(`Row ${i}:`, JSON.stringify(ws.getRow(i).values));
  }
}

main().catch(console.error);
