const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx');
  const ws = wb.worksheets[0];
  
  console.log(`Checking rows with column H:`);
  let count = 0;
  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const hVal = row.getCell(8).value;
    if (hVal !== null && hVal !== undefined) {
      console.log(`Row ${i} Col H: "${hVal}" | Row values: ${JSON.stringify(row.values.slice(1, 10))}`);
      count++;
      if (count > 20) break;
    }
  }
}

main().catch(console.error);
