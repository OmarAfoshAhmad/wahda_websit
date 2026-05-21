const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - مطابقة المرافق.xlsx');
  const ws = wb.worksheets[0];
  
  let matchedCount = 0;
  let unmatchedCount = 0;
  
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const excelName = row.getCell(1).value;
    const systemName = row.getCell(2).value;
    const status = row.getCell(3).value;
    
    if (status === 'غير مطابق') {
      unmatchedCount++;
      console.log(`❌ Unmatched: "${excelName}"`);
    } else {
      matchedCount++;
    }
  }
  
  console.log(`Matched: ${matchedCount}, Unmatched: ${unmatchedCount}`);
}

main().catch(console.error);
