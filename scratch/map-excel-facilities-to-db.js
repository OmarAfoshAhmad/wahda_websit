const ExcelJS = require('exceljs');
const fs = require('fs');

const FACILITY_MAP = {
  "الليبية التخصصية": "cmn78k17t0034nz1nkwiklngp",
  "الليبية التخصصية - اسنان": "cmn78k17t0034nz1nkwiklngp",
  "الليبية التخصصيه": "cmn78k17t0034nz1nkwiklngp",
  "الليبيه التخصصيه": "cmn78k17t0034nz1nkwiklngp",
  "الليبيه التخصيصيه": "cmn78k17t0034nz1nkwiklngp",
  "فينيسيا": "cmn78k17t0035nz1n3t9j6iey",
  "مركز فينيسيا - اسنان": "cmn78k17t0035nz1n3t9j6iey",
  "مستشفى فينيسيا": "cmn78k17t0035nz1n3t9j6iey",
  "فنيسيا": "cmn78k17t0035nz1n3t9j6iey",
  "عيادة الابتسامه": "cmn78k17t0033nz1n8kwgcf2i",
  "الابتسامه": "cmn78k17t0033nz1n8kwgcf2i",
  "الابتسامة": "cmn78k17t0033nz1n8kwgcf2i",
  "الايتسامة": "cmn78k17t0033nz1n8kwgcf2i",
  "مركز الابتسامة  - اسنان": "cmn78k17t0033nz1n8kwgcf2i",
  "مركز الابتسامه": "cmn78k17t0033nz1n8kwgcf2i",
  "مركز قيس": "cmnovn0z9059vpm0o6024iq09",
  "مركز قيس للاسنان": "cmnovn0z9059vpm0o6024iq09",
  "القيس": "cmnovn0z9059vpm0o6024iq09",
  "الامل": "cmn78k17t0032nz1nbcu8a0jr",
  "مركز الامل": "cmn78k17t0032nz1nbcu8a0jr",
  "مركز الامل - اسنان": "cmn78k17t0032nz1nbcu8a0jr",
  "الريادة": "cmnfobmdu0asrpm0o2phplk8v",
  "مركز الريادة": "cmnfobmdu0asrpm0o2phplk8v",
  "مركز الريادة للاسنان": "cmnfobmdu0asrpm0o2phplk8v",
  "الرياده": "cmnfobmdu0asrpm0o2phplk8v",
  "التيجان": "cmn78k17t003hnz1niuni1ruy",
  "تيجان": "cmn78k17t003hnz1niuni1ruy",
  "الهلال الاحمر - البركة": "cmn4pktb8000cn82k834igzmj",
  "دينتال": "cmn78k17t003gnz1nguqwjd8n",
  "مركز الحياة": "cmn4pktb9003on82kw9kzwrgo",
  "مركز درنه": "cmn78k17t003fnz1ntwonox2n",
  "مصحة الاستشاري": "cmn4pktb9002ln82kk9hadztc",
  "مصحة الحكمة": "cmn4pktb90042n82kqob8niyt",
  "نبض الحياه": "cmn4pktb9004bn82kbp7iafvl"
};

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
  if (/^\d+$/.test(s)) return false;
  for (const word of stopWords) {
    if (s.includes(word)) return false;
  }
  if (s === 'بنغازي' || s === 'طرابلس') return false;
  return true;
}

const resolveFacility = (name, dbFacilities) => {
  if (!name) return null;
  const clean = name.trim();
  
  // 1. Check custom map
  const mappedId = FACILITY_MAP[clean];
  if (mappedId) {
    const found = dbFacilities.find(f => f.id === mappedId);
    if (found) return { found, type: "مطابق بالقاموس" };
  }

  // 2. Exact match
  const exact = dbFacilities.find(f => f.name === clean);
  if (exact) return { found: exact, type: "مطابق تلقائياً (تطابق تام)" };

  // 3. Loose match
  const cleanLower = clean.replace(/\s+/g, "").toLowerCase();
  const loose = dbFacilities.find(f => {
    const cleanDb = f.name.replace(/\s+/g, "").toLowerCase();
    return cleanDb.includes(cleanLower) || cleanLower.includes(cleanDb);
  });
  
  if (loose) {
    return { found: loose, type: "مطابق تلقائياً (تطابق جزئي)" };
  }
  
  return null;
};

async function main() {
  // Load database facilities
  const dbFacilities = JSON.parse(fs.readFileSync('scratch/db-facilities.json', 'utf8'));
  
  const wbSrc = new ExcelJS.Workbook();
  await wbSrc.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx');
  const wsSrc = wbSrc.worksheets[0];
  
  const facilitiesSet = new Set();
  for (let i = 2; i <= wsSrc.rowCount; i++) {
    const row = wsSrc.getRow(i);
    const fVal = row.getCell(6).value;
    const gVal = row.getCell(7).value;
    
    const fStr = fVal ? String(fVal).trim() : '';
    const gStr = gVal ? String(gVal).trim() : '';
    
    if (isFacility(fStr)) facilitiesSet.add(fStr);
    if (isFacility(gStr)) facilitiesSet.add(gStr);
  }
  
  const uniqueExcelFacilities = Array.from(facilitiesSet).sort((a, b) => a.localeCompare(b, 'ar'));
  
  const mappedResults = uniqueExcelFacilities.map(excelName => {
    const matched = resolveFacility(excelName, dbFacilities);
    if (matched) {
      return {
        excelName,
        systemName: matched.found.name,
        systemId: matched.found.id,
        status: matched.type
      };
    } else {
      return {
        excelName,
        systemName: 'غير مطابق بقاعدة البيانات ❌',
        systemId: '',
        status: 'غير مطابق'
      };
    }
  });
  
  // Write to a new Excel file
  const wbDest = new ExcelJS.Workbook();
  const wsDest = wbDest.addWorksheet('مطابقة المرافق');
  
  wsDest.addRow([
    'اسم المرفق في ملف الخصومات',
    'اسم المرفق المقابل في المنظومة',
    'حالة المطابقة',
    'معرف المرفق في المنظومة (ID)'
  ]);
  
  for (const item of mappedResults) {
    wsDest.addRow([
      item.excelName,
      item.systemName,
      item.status,
      item.systemId
    ]);
  }
  
  // Design formatting
  const headerRow = wsDest.getRow(1);
  headerRow.height = 28;
  
  // Style headers
  for (let c = 1; c <= 4; c++) {
    const cell = headerRow.getCell(c);
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF008080' } // Premium Teal theme
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  
  // Formatting cells based on matching status
  for (let i = 2; i <= wsDest.rowCount; i++) {
    const row = wsDest.getRow(i);
    const statusVal = row.getCell(3).value;
    
    // Default alignment
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
    
    if (statusVal === 'غير مطابق') {
      row.getCell(2).font = { color: { argb: 'FFFF0000' }, bold: true };
      row.getCell(3).font = { color: { argb: 'FFFF0000' }, bold: true };
      row.getCell(3).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEEEE' } // Light red background
      };
    } else {
      row.getCell(3).font = { color: { argb: 'FF008000' }, bold: true };
      row.getCell(3).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8F5E9' } // Light green background
      };
    }
  }
  
  // Set Column Widths
  wsDest.columns.forEach(column => {
    let maxLen = 0;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.max(maxLen + 4, 25);
  });
  
  const destPath = 'c:/Users/Omar/waad_temp_website/خصومات الاسنان - مطابقة المرافق.xlsx';
  await wbDest.xlsx.writeFile(destPath);
  console.log(`Successfully generated mapped facilities file at ${destPath}`);
}

main().catch(console.error);
