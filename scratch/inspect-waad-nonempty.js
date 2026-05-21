const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  console.log(`Sheet name: ${ws.name}, Rows: ${ws.rowCount}`);
  
  let count = 0;
  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const vals = [];
    row.eachCell({ includeEmpty: true }, (c) => {
      vals.push(c.value);
    });
    // Check if there is any non-null cell
    const hasData = vals.some(v => v !== null && v !== undefined && v !== "");
    if (hasData) {
      count++;
      if (i > 120 && i <= 150) {
        console.log(`Row ${i}:`, JSON.stringify(vals));
      }
    }
  }
  console.log(`Total non-empty rows: ${count}`);
}

main().catch(console.error);
