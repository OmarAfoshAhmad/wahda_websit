const ExcelJS = require('exceljs');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx');
  const ws = wb.worksheets[0];
  
  const colF = new Set();
  const colG = new Set();
  const colH = new Set();
  
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const f = row.getCell(6).value;
    const g = row.getCell(7).value;
    const h = row.getCell(8).value;
    
    if (f !== null) colF.add(String(f).trim());
    if (g !== null) colG.add(String(g).trim());
    if (h !== null) colH.add(String(h).trim());
  }
  
  console.log(`Col F (6) Unique (Count: ${colF.size}):`, Array.from(colF));
  console.log(`Col G (7) Unique (Count: ${colG.size}):`, Array.from(colG));
  console.log(`Col H (8) Unique (Count: ${colH.size}):`, Array.from(colH));
}

main().catch(console.error);
