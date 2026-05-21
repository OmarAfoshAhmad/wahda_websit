const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/MERG ARCADIA/سجل الموظفين اركاديا المدمج.xlsx');
  const ws = wb.getWorksheet(1);
  console.log(`Current Arcadia file row count: ${ws.rowCount}`);
}

main().catch(console.error);
