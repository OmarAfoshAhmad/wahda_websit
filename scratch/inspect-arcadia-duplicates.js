const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/MERG ARCADIA/سجل الموظفين اركاديا المدمج.xlsx');
  const ws = wb.getWorksheet(1);
  
  const cards = new Map();
  for (let i = 4; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const cardVal = row.getCell(11).value;
    const nameVal = row.getCell(3).value;
    const cancelVal = row.getCell(12).value;
    
    const card = cardVal ? String(cardVal).trim().toUpperCase() : '';
    const name = nameVal ? String(nameVal).trim() : '';
    const isCancelled = cancelVal && String(cancelVal).includes('الغاء');
    
    if (card && !isCancelled) {
      if (!cards.has(card)) {
        cards.set(card, []);
      }
      cards.get(card).push({ row: i, name });
    }
  }
  
  console.log(`Duplicate Card Numbers in Arcadia Excel:`);
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
