const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  
  const cardPatterns = new Set();
  const nonMatchingCards = [];
  const pattern = /^WAAD2025.*/;
  
  for (let i = 6; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const cardVal = row.getCell(7).value;
    const nameVal = row.getCell(3).value;
    const name = nameVal ? String(nameVal).trim() : '';
    const card = cardVal ? String(cardVal).trim().toUpperCase() : '';
    
    if (!name && !card) continue;
    
    if (card) {
      const match = pattern.test(card);
      if (!match) {
        nonMatchingCards.push({ row: i, name, card });
      }
      // Get the prefix (first few chars)
      const prefix = card.slice(0, 8);
      cardPatterns.add(prefix);
    }
  }
  
  console.log(`Card Patterns found:`, Array.from(cardPatterns));
  console.log(`Number of non-matching cards: ${nonMatchingCards.length}`);
  if (nonMatchingCards.length > 0) {
    console.log(`First 10 non-matching cards:`, nonMatchingCards.slice(0, 10));
  }
}

main().catch(console.error);
