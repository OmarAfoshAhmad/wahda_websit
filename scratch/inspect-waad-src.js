const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  console.log(`Sheet name: ${ws.name}, Rows: ${ws.rowCount}`);
  
  for (let i = 1; i <= 20; i++) {
    const row = ws.getRow(i);
    const vals = [];
    row.eachCell({ includeEmpty: true }, (c) => {
      vals.push(c.value);
    });
    console.log(`Row ${i}:`, JSON.stringify(vals));
  }
}

main().catch(console.error);
