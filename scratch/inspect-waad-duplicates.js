const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  
  const cards = new Map();
  for (let i = 6; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const cardVal = row.getCell(7).value;
    const nameVal = row.getCell(3).value;
    
    const card = cardVal ? String(cardVal).trim().toUpperCase() : '';
    const name = nameVal ? String(nameVal).trim() : '';
    
    if (card) {
      if (!cards.has(card)) {
        cards.set(card, []);
      }
      cards.get(card).push({ row: i, name });
    }
  }
  
  console.log(`Duplicate Card Numbers in Waad TPA Excel:`);
  for (const [card, rows] of cards.entries()) {
    if (rows.length > 1) {
      console.log(`Card: "${card}" is duplicate:`);
      rows.forEach(r => {
        console.log(`  - Row ${r.row}: "${r.name}"`);
      });
    }
  }
}

main().catch(console.error);
