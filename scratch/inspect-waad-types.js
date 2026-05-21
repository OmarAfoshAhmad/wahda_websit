const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  
  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const colA = row.getCell(1).value;
    if (colA === 'B' || colA === 'T') {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (c) => {
        vals.push(c.value);
      });
      console.log(`Row ${i} (${colA}):`, JSON.stringify(vals));
    }
  }
}

main().catch(console.error);
