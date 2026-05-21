const ExcelJS = require('exceljs');

const stopWords = [
  'متبقي', 'متبق', 'سقف', 'السقف', 'خصم', 'خصمت', 'تعديل', 'موافقة', 'موافقه',
  'ملغي', 'ملغية', 'ملغيات', 'مكرره', 'مكرر', 'كليم', 'الكليم', 'claim',
  'شغل', '؟', '*', 'استوفت', 'استوفى', 'إستوفي', 'تخطي', 'تخطى', 'تخطت',
  'حالة', 'استثنائية', 'بدون', 'قيمة', 'القيمة', 'ملاحظات', 'الملاحظات',
  'التاريخ', 'الجيهة', 'الي الان', 'ع السقف'
];

function isFacility(s) {
  if (!s) return false;
  s = s.trim();
  if (s.length <= 2) return false;
  
  // If it's just a number
  if (/^\d+$/.test(s)) return false;
  
  // Check stop words
  for (const word of stopWords) {
    if (s.includes(word)) return false;
  }
  
  // If it is just 'بنغازي' or 'طرابلس' or 'المنطقة' (likely city/region column)
  if (s === 'بنغازي' || s === 'طرابلس') return false;
  
  return true;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx');
  const ws = wb.worksheets[0];
  
  const facilities = new Set();
  const skipped = [];
  
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const fVal = row.getCell(6).value;
    const gVal = row.getCell(7).value;
    
    const fStr = fVal ? String(fVal).trim() : '';
    const gStr = gVal ? String(gVal).trim() : '';
    
    if (isFacility(fStr)) {
      facilities.add(fStr);
    } else if (fStr) {
      skipped.push({ row: i, col: 'F', val: fStr });
    }
    
    if (isFacility(gStr)) {
      facilities.add(gStr);
    } else if (gStr) {
      skipped.push({ row: i, col: 'G', val: gStr });
    }
  }
  
  const sorted = Array.from(facilities).sort((a, b) => a.localeCompare(b, 'ar'));
  console.log(`Matched Facilities (${sorted.length}):`);
  console.log(sorted);
  
  console.log(`\nSample of Skipped items (Total: ${skipped.length}):`);
  skipped.slice(0, 30).forEach(x => {
    console.log(`  - Row ${x.row} Col ${x.col}: "${x.val}"`);
  });
}

main().catch(console.error);
