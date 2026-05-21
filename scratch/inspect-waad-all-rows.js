const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx');
  const ws = wb.getWorksheet(1);
  console.log(`Sheet name: ${ws.name}, Rows: ${ws.rowCount}`);
  
  let validRowsCount = 0;
  let emptyRowsCount = 0;
  let nameNoCard = 0;
  let cardNoName = 0;
  
  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const nameVal = row.getCell(3).value;
    const cardVal = row.getCell(7).value;
    
    const name = nameVal ? String(nameVal).trim() : '';
    const card = cardVal ? String(cardVal).trim() : '';
    
    if (name && card) {
      validRowsCount++;
    } else if (!name && !card) {
      emptyRowsCount++;
    } else if (name && !card) {
      nameNoCard++;
      if (nameNoCard <= 10) {
        console.log(`Row ${i} has Name but no Card: name = "${name}"`);
      }
    } else if (!name && card) {
      cardNoName++;
      if (cardNoName <= 10) {
        console.log(`Row ${i} has Card but no Name: card = "${card}"`);
      }
    }
  }
  
  console.log(`Summary:`);
  console.log(`- Both Name and Card: ${validRowsCount}`);
  console.log(`- Empty: ${emptyRowsCount}`);
  console.log(`- Name but no Card: ${nameNoCard}`);
  console.log(`- Card but no Name: ${cardNoName}`);
}

main().catch(console.error);
