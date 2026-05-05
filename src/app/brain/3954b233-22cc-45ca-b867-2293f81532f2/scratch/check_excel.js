const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(process.cwd(), 'دفعة 17.xlsx');
const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Read as JSON with raw values
const data = XLSX.utils.sheet_to_json(sheet, { raw: true });

const mohammad = data.find(row => 
  Object.values(row).some(val => String(val).includes('5034'))
);

console.log('--- Mohammad Row Raw ---');
console.log(JSON.stringify(mohammad, null, 2));

// Check specifically the birth date key
const birthDateKey = Object.keys(mohammad || {}).find(k => k.includes('تاريخ') || k.includes('الميلاد') || k.includes('مواليد'));
if (birthDateKey) {
  const val = mohammad[birthDateKey];
  console.log('Birth Date Key:', birthDateKey);
  console.log('Value:', val);
  console.log('Type:', typeof val);
  if (val instanceof Date) {
    console.log('Is instance of Date: true');
    console.log('ISO:', val.toISOString());
    console.log('Local Y-M-D:', val.getFullYear(), val.getMonth() + 1, val.getDate());
  }
}
