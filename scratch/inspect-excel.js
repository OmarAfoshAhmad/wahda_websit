const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
  const filePath = path.join(__dirname, '..', 'خصومات الاسنان - Copy.xlsx');
  console.log('Reading file:', filePath);
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
  console.log('Worksheet name:', ws.name);
  console.log('Total rows:', ws.rowCount);
  
  // Read first 10 rows
  for (let i = 1; i <= Math.min(15, ws.rowCount); i++) {
    const row = ws.getRow(i);
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      vals.push(cell.value);
    });
    console.log(`Row ${i}:`, vals.slice(0, 12));
  }
}

main().catch(console.error);
