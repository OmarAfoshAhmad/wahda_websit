const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  
  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    row.eachCell({ includeEmpty: true }, (cell, colIndex) => {
      const val = cell.value;
      if (val && (String(val).includes('الغاء') || String(val).includes('إلغاء') || String(val).includes('ملغ') || String(val).includes('موقوف') || String(val).includes('موقف'))) {
        console.log(`Row ${i}, Col ${colIndex} matches keyword: "${val}"`);
      }
    });
  }
}

main().catch(console.error);
