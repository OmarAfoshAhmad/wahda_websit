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
  
  for (const ws of wb.worksheets) {
    console.log(`Sheet name: ${ws.name}, Rows: ${ws.rowCount}`);
    for (let r = 1; r <= 15; r++) {
      const row = ws.getRow(r);
      const vals = [];
      row.eachCell({ includeEmpty: true }, (c) => {
        vals.push(c.value);
      });
      if (vals.some(v => v !== null && v !== undefined && v !== "")) {
        console.log(`  Row ${r}:`, JSON.stringify(vals.slice(0, 15)));
      }
    }
  }
}

async function main() {
  for (const f of filesToInspect) {
    await inspectFile(f);
  }
}

main().catch(console.error);
