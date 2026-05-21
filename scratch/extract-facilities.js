const ExcelJS = require('exceljs');
const fs = require('fs');

async function main() {
  const wbSrc = new ExcelJS.Workbook();
  await wbSrc.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx');
  const wsSrc = wbSrc.worksheets[0];
  
  const facilities = new Set();
  
  for (let i = 2; i <= wsSrc.rowCount; i++) {
    const row = wsSrc.getRow(i);
    const facilityCell = row.getCell(8).value || row.getCell(7).value; // Let's check both index 7 and 8 to be safe
    // Actually, let's look at the exact values in row 2 to see which cell has "الليبية التخصصية"
    const val7 = row.getCell(7).value;
    const val8 = row.getCell(8).value;
    
    // We printed: [null,"نجاح علي علي بن موسي","LCC202500400","LCC001",1200,"25/1/2026"," ","الليبية التخصصية"]
    // In row.values, index 1 is "اسم المريض", 2 is "رقم التأمين", 3 is "رقم الموافقة", 4 is "القيمة المالية", 5 is "التاريخ", 6 is "ملاحظات", 7 is "المرفق الصحي"
    // Wait, let's verify if row.getCell(7).value or row.getCell(8).value is the facility.
    // getCell(1) is A, getCell(2) is B, getCell(3) is C, getCell(4) is D, getCell(5) is E, getCell(6) is F, getCell(7) is G, getCell(8) is H.
    // If the array has 8 elements (first is null, followed by 7 values), then the last value is at index 7 of the values array, which is getCell(7).
    // Let's check which cell actually has the facility name by checking both or printing a few.
    const facility = val7 ? String(val7).trim() : (val8 ? String(val8).trim() : '');
    if (facility && facility !== 'المرفق الصحي' && facility !== 'null' && facility !== ' ') {
      facilities.add(facility);
    }
  }
  
  const sortedFacilities = Array.from(facilities).sort((a, b) => a.localeCompare(b, 'ar'));
  
  console.log(`Extracted ${sortedFacilities.length} unique health facilities:`);
  console.log(sortedFacilities);
  
  const wbDest = new ExcelJS.Workbook();
  const wsDest = wbDest.addWorksheet('المرافق الصحية');
  
  wsDest.addRow(['اسم المرفق الصحي']);
  
  for (const f of sortedFacilities) {
    wsDest.addRow([f]);
  }
  
  // Auto-fit columns
  wsDest.columns.forEach(column => {
    let maxLen = 0;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.max(maxLen + 4, 25);
  });
  
  const destPath = 'c:/Users/Omar/waad_temp_website/المرافق الصحية للأسنان.xlsx';
  await wbDest.xlsx.writeFile(destPath);
  console.log(`Successfully saved facilities to ${destPath}`);
}

main().catch(console.error);
