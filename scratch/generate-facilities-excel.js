const ExcelJS = require('exceljs');
const fs = require('fs');

const stopWords = [
  'متبقي', 'متبق', 'سقف', 'السقف', 'خصم', 'خصمت', 'خضمت', 'خضم', 'تعديل', 'موافقة', 'موافقه',
  'ملغي', 'ملغية', 'ملغيات', 'مكرره', 'مكرر', 'كليم', 'الكليم', 'claim',
  'شغل', '؟', '*', 'استوفت', 'استوفى', 'إستوفي', 'تخطي', 'تخطى', 'تخطت',
  'حالة', 'استثنائية', 'بدون', 'قيمة', 'القيمة', 'ملاحظات', 'الملاحظات',
  'التاريخ', 'الجيهة', 'الي الان', 'ع السقف'
];

function isFacility(s) {
  if (!s) return false;
  s = s.trim();
  if (s.length <= 2) return false;
  
  // If it's just a number or code
  if (/^\d+$/.test(s)) return false;
  
  // Check stop words
  for (const word of stopWords) {
    if (s.includes(word)) return false;
  }
  
  // If it is just a city name
  if (s === 'بنغازي' || s === 'طرابلس') return false;
  
  return true;
}

async function main() {
  const wbSrc = new ExcelJS.Workbook();
  await wbSrc.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx');
  const wsSrc = wbSrc.worksheets[0];
  
  const facilities = new Set();
  
  for (let i = 2; i <= wsSrc.rowCount; i++) {
    const row = wsSrc.getRow(i);
    const fVal = row.getCell(6).value;
    const gVal = row.getCell(7).value;
    
    const fStr = fVal ? String(fVal).trim() : '';
    const gStr = gVal ? String(gVal).trim() : '';
    
    if (isFacility(fStr)) {
      facilities.add(fStr);
    }
    if (isFacility(gStr)) {
      facilities.add(gStr);
    }
  }
  
  const sortedFacilities = Array.from(facilities).sort((a, b) => a.localeCompare(b, 'ar'));
  
  console.log(`Extracted ${sortedFacilities.length} unique health facilities.`);
  
  const wbDest = new ExcelJS.Workbook();
  const wsDest = wbDest.addWorksheet('المرافق الصحية');
  
  wsDest.addRow(['اسم المرفق الصحي']);
  
  for (const f of sortedFacilities) {
    wsDest.addRow([f]);
  }
  
  // Format column width
  wsDest.columns.forEach(column => {
    let maxLen = 0;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.max(maxLen + 4, 30);
  });
  
  // Apply a nice premium header style
  const headerRow = wsDest.getRow(1);
  headerRow.height = 25;
  headerRow.getCell(1).font = {
    name: 'Calibri',
    size: 12,
    bold: true,
    color: { argb: 'FFFFFFFF' }
  };
  headerRow.getCell(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF008080' } // Teal theme
  };
  headerRow.getCell(1).alignment = {
    vertical: 'middle',
    horizontal: 'center'
  };
  
  const destPath = 'c:/Users/Omar/waad_temp_website/خصومات الاسنان - المرافق الصحية.xlsx';
  await wbDest.xlsx.writeFile(destPath);
  console.log(`Successfully saved final facilities list to ${destPath}`);
}

main().catch(console.error);
