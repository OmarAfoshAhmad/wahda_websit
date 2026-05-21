const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان جاهزة للاستيراد/Waad_List_Import.xlsx');
  const ws = wb.getWorksheet(1);
  console.log(`Waad List Import rows count: ${ws.rowCount}`);
  
  const cards = new Set();
  for (let i = 2; i <= ws.rowCount; i++) {
    const card = ws.getRow(i).getCell(2).value;
    if (cards.has(card)) {
      console.log(`Duplicate found in output: ${card}`);
    }
    cards.add(card);
  }
  console.log(`Unique cards count in output: ${cards.size}`);
}

main().catch(console.error);
