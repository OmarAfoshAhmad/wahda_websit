const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad architect/الوعد المعماري قائمة اسماء 1.xlsx');
  console.log(`Sheets in Waad Architect:`, wb.worksheets.map(w => w.name));
}

main().catch(console.error);
