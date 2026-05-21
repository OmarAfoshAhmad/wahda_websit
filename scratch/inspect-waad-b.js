const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  
  const colAValues = new Map();
  for (let i = 1; i <= ws.rowCount; i++) {
    const val = ws.getRow(i).getCell(1).value;
    colAValues.set(val, (colAValues.get(val) || 0) + 1);
  }
  console.log(`Column A distinct values:`, Array.from(colAValues.entries()));
}

main().catch(console.error);
