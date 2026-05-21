const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  
  console.log(`Checking rows after 100 where name is present:`);
  for (let i = 100; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const nameVal = row.getCell(3).value;
    const cardVal = row.getCell(7).value;
    const name = nameVal ? String(nameVal).trim() : '';
    const card = cardVal ? String(cardVal).trim() : '';
    
    if (name) {
      console.log(`Row ${i}: name = "${name}", card = "${card}", Col A = "${row.getCell(1).value}", Col F (DOB) = "${row.getCell(6).value}"`);
    }
  }
}

main().catch(console.error);
