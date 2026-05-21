const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const filesToInspect = [
  { path: 'MERG ARCADIA/سجل الموظفين اركاديا المدمج.xlsx', name: 'Arcadia' },
  { path: 'MERG HJR/HAJAR ALMAS 1 .xlsx', name: 'Hajar' },
  { path: 'merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx', name: 'Waad TPA' },
  { path: 'merg waad architect/الوعد المعماري قائمة اسماء 1.xlsx', name: 'Waad Architect' },
  { path: 'merg waha/كشف بموظفي طرابلس بنغازي (1).xlsx', name: 'Waha' }
];

async function inspectFile(fileInfo) {
  const filePath = path.join('c:/Users/Omar/waad_temp_website', fileInfo.path);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  console.log(`\n=================== ${fileInfo.name} ===================`);
  console.log(`Sheets in file:`, wb.worksheets.map(w => w.name));

  const ws = wb.getWorksheet(1) || wb.worksheets[0];
  console.log(`First sheet name: ${ws.name}`);
  console.log(`Row count: ${ws.rowCount}`);

  const rows = [];
  ws.eachRow((row, index) => {
    if (index <= 5) {
      rows.push(row.values);
    }
  });

  console.log(`Top rows:`);
  rows.forEach((r, idx) => console.log(`Row ${idx+1}:`, JSON.stringify(r)));
}

async function main() {
  for (const f of filesToInspect) {
    await inspectFile(f);
  }
}

main().catch(console.error);
