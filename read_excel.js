const fs = require('fs');
const xlsx = require('xlsx');

function loadExcel() {
  const path = 'c:\\Users\\Omar\\waad_temp_website\\الاسماء_دقيقة.xlsx';
  const buf = fs.readFileSync(path);
  const wb = xlsx.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(ws);
  return data;
}

const data = loadExcel();
console.log("Rows:", data.length);
console.log("First row:", data[0]);
